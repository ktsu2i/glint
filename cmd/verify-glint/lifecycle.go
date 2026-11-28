package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/mxschmitt/playwright-go"
)

// sources are the paths whose changes make the built binary stale.
var sources = []string{
	"main.go",
	"go.mod",
	"go.sum",
	"internal",
	"migrations",
	"frontend/src",
	"frontend/index.html",
	"frontend/vite.config.ts",
	"frontend/package.json",
}

func install() error {
	err := playwright.Install(&playwright.RunOptions{Browsers: []string{"webkit"}})
	if err != nil {
		return fmt.Errorf("install the Playwright driver and WebKit: %w", err)
	}
	return nil
}

func build(ctx context.Context, p paths) error {
	steps := []struct {
		label string
		name  string
		args  []string
	}{
		{"generating bindings", "go", []string{"tool", "wails3", "generate", "bindings", "-ts", "-i"}},
		{"building the frontend", "pnpm", []string{"--dir", "frontend", "run", "build"}},
		{"building the server-mode binary", "go", []string{"build", "-tags", "server verify", "-o", p.binary, "."}},
	}
	if err := os.MkdirAll(filepath.Dir(p.binary), 0o700); err != nil {
		return fmt.Errorf("create the binary directory: %w", err)
	}
	for _, step := range steps {
		fmt.Printf("build: %s\n", step.label)
		var output bytes.Buffer
		cmd := exec.CommandContext(ctx, step.name, step.args...)
		cmd.Dir = p.repo
		cmd.Stdout = &output
		cmd.Stderr = &output
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("%s: %w\n%s", step.label, err, output.String())
		}
	}
	fmt.Printf("build: %s\n", p.binary)
	return nil
}

// staleReason returns why the binary is older than the sources, or "" when it
// is fresh.
func staleReason(p paths) (string, error) {
	info, err := os.Stat(p.binary)
	if errors.Is(err, fs.ErrNotExist) {
		return "the binary is not built", nil
	}
	if err != nil {
		return "", fmt.Errorf("stat the binary: %w", err)
	}
	for _, source := range sources {
		newest, err := newestModification(filepath.Join(p.repo, source))
		if err != nil {
			return "", err
		}
		if newest.After(info.ModTime()) {
			return source + " changed after the build", nil
		}
	}
	return "", nil
}

func newestModification(root string) (time.Time, error) {
	var newest time.Time
	err := filepath.WalkDir(root, func(_ string, entry fs.DirEntry, err error) error {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		return nil
	})
	if err != nil {
		return time.Time{}, fmt.Errorf("scan %s: %w", root, err)
	}
	return newest, nil
}

func start(ctx context.Context, p paths, args []string) error {
	skipBuild := false
	for _, arg := range args {
		if arg != "--skip-build" {
			return fmt.Errorf("unknown flag %q", arg)
		}
		skipBuild = true
	}
	running, err := readInstance(p)
	if err != nil {
		return err
	}
	if running != nil && isAlive(running.HostPID) {
		return errors.New("glint is already running. Run `stop` first")
	}
	if !skipBuild {
		reason, err := staleReason(p)
		if err != nil {
			return err
		}
		if reason != "" {
			fmt.Printf("start: rebuilding (%s)\n", reason)
			if err := build(ctx, p); err != nil {
				return err
			}
		}
	}
	if _, err := os.Stat(p.binary); err != nil {
		return errors.New("the binary is not built. Run `build`")
	}
	if err := removeRunData(p); err != nil {
		return err
	}
	for _, dir := range []string{p.home, p.dialogs} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve the verify-glint executable: %w", err)
	}
	// The host outlives this command, so it must not be tied to ctx.
	host := exec.Command(executable, hostCommand) //nolint:noctx // the host is detached and stopped by `stop`
	host.Dir = p.repo
	host.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := host.Start(); err != nil {
		return fmt.Errorf("start the host: %w", err)
	}
	exited := make(chan struct{})
	go func() {
		_ = host.Wait()
		close(exited)
	}()
	deadline := time.After(90 * time.Second)
	for {
		state, err := readInstance(p)
		if err != nil {
			return err
		}
		if state != nil {
			fmt.Println(info(p, *state))
			return nil
		}
		select {
		case <-exited:
			return fmt.Errorf("the host exited before it was ready%s", hostLogHint(p))
		case <-deadline:
			return fmt.Errorf("the host was not ready within 90s%s", hostLogHint(p))
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func hostLogHint(p paths) string {
	data, err := os.ReadFile(p.hostLog)
	if err != nil {
		return ""
	}
	log := string(data)
	if strings.Contains(log, "install the driver") || strings.Contains(log, "Executable doesn't exist") {
		log += "\nRun `go tool verify-glint install` first."
	}
	return ":\n" + log
}

func removeRunData(p paths) error {
	for _, path := range p.runData() {
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("remove %s: %w", path, err)
		}
	}
	return nil
}

func stopInstance(ctx context.Context, p paths) error {
	state, err := readInstance(p)
	if err != nil {
		return err
	}
	if state != nil && isAlive(state.HostPID) {
		if _, err := sendToHost(ctx, p, "shutdown", nil); err != nil {
			_ = syscall.Kill(state.HostPID, syscall.SIGTERM)
		}
		deadline := time.Now().Add(20 * time.Second)
		for isAlive(state.HostPID) && time.Now().Before(deadline) {
			time.Sleep(100 * time.Millisecond)
		}
		if isAlive(state.HostPID) {
			_ = syscall.Kill(state.HostPID, syscall.SIGKILL)
		}
	}
	if err := removeRunData(p); err != nil {
		return err
	}
	fmt.Println("stopped")
	return nil
}

func info(p paths, state instance) string {
	return strings.Join([]string{
		fmt.Sprintf("app       http://localhost:%d/", state.AppPort),
		fmt.Sprintf("host      pid %d, port %d", state.HostPID, state.HostPort),
		"started   " + state.StartedAt.Format(time.RFC3339),
		"database  " + p.database,
		"dialogs   " + p.dialogs,
		"logs      " + p.appLog,
	}, "\n")
}

func printInfo(p paths) error {
	state, err := readInstance(p)
	if err != nil {
		return err
	}
	if state == nil {
		fmt.Println("not running")
		return nil
	}
	fmt.Println(info(p, *state))
	return nil
}

func doctor(ctx context.Context, p paths) error {
	lines := []string{"state     " + p.state}
	healthy := true
	reason, err := staleReason(p)
	if err != nil {
		return err
	}
	if reason == "" {
		lines = append(lines, "OK        build is newer than the sources")
	} else {
		healthy = false
		lines = append(lines, "STALE BUILD  "+reason+". Run `stop`, then `start`.")
	}
	state, err := readInstance(p)
	if err != nil {
		return err
	}
	switch {
	case state == nil:
		lines = append(lines, "--        not running")
	case !isAlive(state.HostPID):
		healthy = false
		lines = append(lines, fmt.Sprintf("FAIL      host pid %d is gone. Run `stop`, then `start`.", state.HostPID))
	default:
		lines = append(lines, fmt.Sprintf("OK        host pid %d", state.HostPID))
		if appAnswers(ctx, state.AppPort) {
			lines = append(lines, fmt.Sprintf("OK        app answers on port %d", state.AppPort))
		} else {
			healthy = false
			lines = append(lines, fmt.Sprintf("FAIL      app does not answer on port %d. See `logs`.", state.AppPort))
		}
		if executable, err := os.Executable(); err == nil && executable != state.Executable {
			healthy = false
			lines = append(lines, "STALE DRIVER  verify-glint changed after start. Run `stop`, then `start`.")
		}
		if binary, err := os.Stat(p.binary); err == nil && binary.ModTime().After(state.StartedAt) {
			healthy = false
			lines = append(lines, "STALE INSTANCE  the binary was rebuilt after start. Run `stop`, then `start`.")
		}
	}
	for _, answer := range []string{"open-file", "confirm"} {
		if _, err := os.Stat(filepath.Join(p.dialogs, answer)); err == nil {
			healthy = false
			lines = append(lines, "WARN      unused dialog answer: "+answer+". The next dialog will take it.")
		}
	}
	if healthy {
		lines = append(lines, "doctor: ok")
	} else {
		lines = append(lines, "doctor: needs attention")
	}
	fmt.Println(strings.Join(lines, "\n"))
	return nil
}

func appAnswers(ctx context.Context, port int) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://localhost:%d/", port), nil)
	if err != nil {
		return false
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return false
	}
	_ = response.Body.Close()
	return response.StatusCode == http.StatusOK
}
