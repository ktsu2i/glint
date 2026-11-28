package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/mxschmitt/playwright-go"
)

const actionTimeout = 10 * time.Second

// hostCommands are forwarded to the host, which owns the page.
var hostCommands = map[string]bool{
	"open": true, "reload": true, "click": true, "click-css": true, "mouse-click": true,
	"right-click": true, "press": true, "type": true, "select-text": true, "hover": true,
	"snapshot": true, "screenshot": true, "wait": true, "eval": true, "console": true,
	"restart-app": true, "color-scheme": true,
}

func isHostCommand(name string) bool { return hostCommands[name] }

type hostRequest struct {
	Name string   `json:"name"`
	Args []string `json:"args"`
}

type hostReply struct {
	OK     bool   `json:"ok"`
	Output string `json:"output"`
}

func sendToHost(ctx context.Context, p paths, name string, args []string) (string, error) {
	state, err := readInstance(p)
	if err != nil {
		return "", err
	}
	if state == nil || !isAlive(state.HostPID) {
		return "", errNotRunning
	}
	if args == nil {
		args = []string{}
	}
	body, err := json.Marshal(hostRequest{Name: name, Args: args})
	if err != nil {
		return "", fmt.Errorf("encode the command: %w", err)
	}
	url := "http://127.0.0.1:" + strconv.Itoa(state.HostPort) + "/command"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build the request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("reach the host: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	var reply hostReply
	if err := json.NewDecoder(response.Body).Decode(&reply); err != nil {
		return "", fmt.Errorf("read the host reply: %w", err)
	}
	if !reply.OK {
		return "", errors.New(reply.Output)
	}
	return reply.Output, nil
}

// host keeps the app process and one page alive between CLI commands.
type host struct {
	paths   paths
	appPort int
	appURL  string
	app     *appProcess
	page    playwright.Page

	mu      sync.Mutex // serializes commands
	console consoleBuffer
}

type consoleBuffer struct {
	mu    sync.Mutex
	lines []string
}

func (c *consoleBuffer) add(line string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lines = append(c.lines, line)
}

func (c *consoleBuffer) drain() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	lines := c.lines
	c.lines = nil
	return lines
}

func runHost(ctx context.Context, p paths) (err error) {
	logFile, err := os.OpenFile(p.hostLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open the host log: %w", err)
	}
	defer func() { _ = logFile.Close() }()
	logf := func(format string, args ...any) {
		_, _ = fmt.Fprintf(logFile, "%s %s\n", time.Now().Format(time.RFC3339), fmt.Sprintf(format, args...))
	}
	defer func() {
		if err != nil {
			logf("failed: %v", err)
		}
	}()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	appPort, err := freePort(ctx)
	if err != nil {
		return err
	}
	h := &host{paths: p, appPort: appPort, appURL: "http://localhost:" + strconv.Itoa(appPort)}
	if err := h.startApp(ctx); err != nil {
		return err
	}
	// restart-app replaces h.app, so stop whichever run is current.
	defer func() { h.app.stop() }()

	pw, err := playwright.Run(&playwright.RunOptions{Stdout: logFile, Stderr: logFile})
	if err != nil {
		return fmt.Errorf("start Playwright: %w", err)
	}
	defer func() { _ = pw.Stop() }()
	browser, err := pw.WebKit.Launch()
	if err != nil {
		return fmt.Errorf("launch WebKit: %w", err)
	}
	defer func() { _ = browser.Close() }()
	browserContext, err := browser.NewContext(playwright.BrowserNewContextOptions{
		Viewport: &playwright.Size{Width: 1440, Height: 900},
		Locale:   new("en-US"),
	})
	if err != nil {
		return fmt.Errorf("create the browser context: %w", err)
	}
	browserContext.SetDefaultTimeout(float64(actionTimeout.Milliseconds()))
	h.page, err = browserContext.NewPage()
	if err != nil {
		return fmt.Errorf("open a page: %w", err)
	}
	h.page.OnConsole(func(message playwright.ConsoleMessage) {
		h.console.add("[" + message.Type() + "] " + message.Text())
	})
	h.page.OnPageError(func(pageErr error) {
		h.console.add("[pageerror] " + pageErr.Error())
	})
	if _, err := h.page.Goto(h.appURL + "/"); err != nil {
		return fmt.Errorf("open the app: %w", err)
	}

	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen for commands: %w", err)
	}
	server := &http.Server{
		Handler:           h.handler(logf, cancel),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() { _ = server.Serve(listener) }()

	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve the executable: %w", err)
	}
	tcp, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return errors.New("unexpected listener address")
	}
	if err := writeInstance(p, instance{
		HostPID:    os.Getpid(),
		HostPort:   tcp.Port,
		AppPort:    appPort,
		Executable: executable,
		StartedAt:  time.Now(),
	}); err != nil {
		return err
	}
	logf("ready on %d, app on %d", tcp.Port, appPort)

	<-ctx.Done()
	logf("shutdown")
	shutdownCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer stop()
	_ = server.Shutdown(shutdownCtx)
	return nil
}

func (h *host) handler(logf func(string, ...any), shutdown context.CancelFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request hostRequest
		reply := hostReply{OK: true}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			reply = hostReply{Output: "malformed command"}
		} else if request.Name == "shutdown" {
			reply.Output = "shutting down"
			defer shutdown()
		} else {
			logf("%s %q", request.Name, request.Args)
			h.mu.Lock()
			output, err := h.run(r.Context(), request.Name, request.Args)
			h.mu.Unlock()
			reply.Output = output
			if err != nil {
				reply = hostReply{Output: err.Error()}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(reply)
	})
}

var waitStates = map[string]*playwright.WaitForSelectorState{
	"visible":  playwright.WaitForSelectorStateVisible,
	"hidden":   playwright.WaitForSelectorStateHidden,
	"attached": playwright.WaitForSelectorStateAttached,
	"detached": playwright.WaitForSelectorStateDetached,
}

// target is where a command looks for elements: the page, or with --in-book
// the frame that shows the current EPUB section.
type target struct {
	locate   func(selector string) playwright.Locator
	evaluate func(expression string) (any, error)
}

// inBookCommands accept --in-book as their first argument.
var inBookCommands = map[string]bool{
	"click-css": true, "mouse-click": true, "right-click": true, "hover": true,
	"select-text": true, "snapshot": true, "wait": true, "eval": true,
}

func (h *host) target(name string, args []string) (target, []string, error) {
	if len(args) == 0 || args[0] != "--in-book" {
		return target{
			locate:   func(selector string) playwright.Locator { return h.page.Locator(selector) },
			evaluate: func(expression string) (any, error) { return h.page.Evaluate(expression) },
		}, args, nil
	}
	if !inBookCommands[name] {
		return target{}, nil, fmt.Errorf("%s does not take --in-book", name)
	}
	frame, err := h.bookFrame()
	if err != nil {
		return target{}, nil, err
	}
	return target{
		locate:   func(selector string) playwright.Locator { return frame.Locator(selector) },
		evaluate: func(expression string) (any, error) { return frame.Evaluate(expression) },
	}, args[1:], nil
}

// bookFrame finds the frame foliate-js renders the current EPUB section in.
// It sits in a closed shadow root, so page selectors cannot reach it, but
// Playwright still lists it as a child frame. It waits for the frame like
// other actions wait for elements.
func (h *host) bookFrame() (playwright.Frame, error) {
	deadline := time.Now().Add(actionTimeout)
	for {
		var urls []string
		for _, frame := range h.page.Frames() {
			if frame == h.page.MainFrame() {
				continue
			}
			urls = append(urls, frame.URL())
			if strings.HasPrefix(frame.URL(), "blob:") {
				return frame, nil
			}
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("no EPUB section is open (child frames: %q)", urls)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func (h *host) run(ctx context.Context, name string, args []string) (string, error) {
	in, args, err := h.target(name, args)
	if err != nil {
		return "", err
	}
	arg := func(i int) string {
		if i < len(args) {
			return args[i]
		}
		return ""
	}
	page := h.page
	switch name {
	case "open":
		path := arg(0)
		if path == "" {
			path = "/"
		}
		if _, err := page.Goto(h.appURL + path); err != nil {
			return "", err
		}
		return page.URL(), nil
	case "reload":
		if _, err := page.Reload(); err != nil {
			return "", err
		}
		return page.URL(), nil
	case "click":
		accessibleName := strings.Join(args[min(1, len(args)):], " ")
		if arg(0) == "" || accessibleName == "" {
			return "", errors.New("usage: click <role> <name>")
		}
		if err := page.Locator(roleSelector(arg(0), accessibleName)).First().Click(); err != nil {
			return "", err
		}
		return fmt.Sprintf("clicked %s %q", arg(0), accessibleName), nil
	case "click-css":
		if err := in.locate(arg(0)).First().Click(); err != nil {
			return "", err
		}
		return "clicked " + arg(0), nil
	case "right-click":
		err := in.locate(arg(0)).First().Click(playwright.LocatorClickOptions{Button: playwright.MouseButtonRight})
		if err != nil {
			return "", err
		}
		return "right-clicked " + arg(0), nil
	case "mouse-click":
		box, err := h.box(in, arg(0))
		if err != nil {
			return "", err
		}
		if err := page.Mouse().Click(box.X+box.Width/2, box.Y+box.Height/2); err != nil {
			return "", err
		}
		return "clicked the center of " + arg(0), nil
	case "press":
		if err := page.Keyboard().Press(arg(0)); err != nil {
			return "", err
		}
		return "pressed " + arg(0), nil
	case "type":
		if err := page.Keyboard().Type(strings.Join(args, " ")); err != nil {
			return "", err
		}
		return "typed", nil
	case "hover":
		if err := in.locate(arg(0)).First().Hover(); err != nil {
			return "", err
		}
		return "hovering " + arg(0), nil
	case "select-text":
		return h.selectText(in, arg(0))
	case "snapshot":
		return in.locate("body").AriaSnapshot()
	case "screenshot":
		file := arg(0)
		if file == "" {
			file = "glint.png"
		}
		file, err := filepath.Abs(file)
		if err != nil {
			return "", err
		}
		if _, err := page.Screenshot(playwright.PageScreenshotOptions{Path: new(file)}); err != nil {
			return "", err
		}
		return file, nil
	case "wait":
		stateName := arg(1)
		if stateName == "" {
			stateName = "visible"
		}
		state, ok := waitStates[stateName]
		if !ok {
			return "", errors.New("state must be visible, hidden, attached, or detached")
		}
		if err := in.locate(arg(0)).First().WaitFor(playwright.LocatorWaitForOptions{State: state}); err != nil {
			return "", err
		}
		return arg(0) + " is " + stateName, nil
	case "eval":
		result, err := in.evaluate(strings.Join(args, " "))
		if err != nil {
			return "", err
		}
		encoded, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	case "console":
		lines := h.console.drain()
		if len(lines) == 0 {
			return "(no console messages)", nil
		}
		return strings.Join(lines, "\n"), nil
	case "color-scheme":
		schemes := map[string]*playwright.ColorScheme{
			"light": playwright.ColorSchemeLight,
			"dark":  playwright.ColorSchemeDark,
		}
		scheme, ok := schemes[arg(0)]
		if !ok {
			return "", errors.New("usage: color-scheme <light|dark>")
		}
		if err := page.EmulateMedia(playwright.PageEmulateMediaOptions{ColorScheme: scheme}); err != nil {
			return "", err
		}
		return "the OS color scheme is now " + arg(0), nil
	case "restart-app":
		h.app.stop()
		if err := h.startApp(ctx); err != nil {
			return "", err
		}
		if _, err := page.Reload(); err != nil {
			return "", err
		}
		return "app restarted on the same data", nil
	}
	return "", fmt.Errorf("unknown command %q", name)
}

func (h *host) box(in target, selector string) (*playwright.Rect, error) {
	element := in.locate(selector).First()
	if err := element.WaitFor(); err != nil {
		return nil, err
	}
	// The box is in page coordinates, also for elements inside a frame.
	box, err := element.BoundingBox()
	if err != nil {
		return nil, err
	}
	if box == nil {
		return nil, fmt.Errorf("%s has no box", selector)
	}
	return box, nil
}

func (h *host) selectText(in target, selector string) (string, error) {
	box, err := h.box(in, selector)
	if err != nil {
		return "", err
	}
	mouse := h.page.Mouse()
	y := box.Y + box.Height/2
	if err := mouse.Move(box.X+1, y); err != nil {
		return "", err
	}
	if err := mouse.Down(); err != nil {
		return "", err
	}
	if err := mouse.Move(box.X+box.Width-1, y, playwright.MouseMoveOptions{Steps: new(8)}); err != nil {
		return "", err
	}
	if err := mouse.Up(); err != nil {
		return "", err
	}
	selected, err := in.evaluate("() => globalThis.getSelection()?.toString() ?? ''")
	if err != nil {
		return "", err
	}
	return strconv.Quote(fmt.Sprint(selected)), nil
}

var regexName = regexp.MustCompile(`^/.+/[a-z]*$`)

// roleSelector builds a Playwright role selector. A /regex/ name matches by
// pattern; any other name matches the accessible name exactly.
func roleSelector(role, name string) string {
	if regexName.MatchString(name) {
		return "role=" + role + "[name=" + name + "]"
	}
	return "role=" + role + "[name=" + strconv.Quote(name) + "s]"
}

// appProcess is one run of the server-mode app.
type appProcess struct {
	cmd    *exec.Cmd
	exited chan struct{}
}

func (h *host) startApp(ctx context.Context) error {
	logFile, err := os.OpenFile(h.paths.appLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open the app log: %w", err)
	}
	cmd := exec.CommandContext(context.WithoutCancel(ctx), h.paths.binary)
	cmd.Dir = h.paths.state
	cmd.Env = append(os.Environ(),
		"HOME="+h.paths.home,
		"WAILS_SERVER_PORT="+strconv.Itoa(h.appPort),
		"GLINT_VERIFY_DIALOGS="+h.paths.dialogs,
	)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return fmt.Errorf("start the app: %w", err)
	}
	app := &appProcess{cmd: cmd, exited: make(chan struct{})}
	go func() {
		_ = cmd.Wait()
		_ = logFile.Close()
		close(app.exited)
	}()
	h.app = app
	return waitForApp(ctx, h.appPort, app.exited)
}

// stop asks the app to shut down so it closes the database, and kills it if
// it does not exit in time.
func (a *appProcess) stop() {
	select {
	case <-a.exited:
		return
	default:
	}
	_ = a.cmd.Process.Signal(syscall.SIGTERM)
	select {
	case <-a.exited:
	case <-time.After(10 * time.Second):
		_ = a.cmd.Process.Kill()
		<-a.exited
	}
}

func waitForApp(ctx context.Context, port int, exited <-chan struct{}) error {
	deadline := time.After(30 * time.Second)
	for {
		if appAnswers(ctx, port) {
			return nil
		}
		select {
		case <-exited:
			return errors.New("the app exited during startup. See `logs`")
		case <-deadline:
			return errors.New("the app did not answer within 30s. See `logs`")
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func freePort(ctx context.Context) (int, error) {
	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("find a free port: %w", err)
	}
	defer func() { _ = listener.Close() }()
	tcp, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, errors.New("unexpected listener address")
	}
	return tcp.Port, nil
}
