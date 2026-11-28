// Command verify-glint drives Glint for verification. A host process keeps the
// app (a server-mode build with scripted dialogs) and one WebKit page alive
// between commands, so an agent can act one step at a time.
//
// Run it with `go tool verify-glint help`.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

const usage = `Usage: go tool verify-glint <command> [args]

Setup
  install                     Download the Playwright driver and WebKit (once)

Lifecycle
  build                       Build the frontend and a server-mode binary with scripted dialogs
  start [--skip-build]        Rebuild if stale, then start the app and a WebKit page on empty data
  stop                        Stop the page and the app and delete their data
  doctor                      Report build freshness, processes, and leftover dialog answers
  info                        Print URLs, ports, and paths of the running instance
  restart-app                 Restart only the app on the same data, then reload the page

Navigation and input
  open [path]                 Load a path of the app (default /)
  reload                      Reload the page
  click <role> <name>         Click by ARIA role and accessible name (/regex/ allowed)
  click-css <selector>        Click the first element matching a CSS selector
  mouse-click <selector>      Click the center of an element with the mouse, even under overlays
  right-click <selector>      Right-click the first matching element (in-page context menus)
  press <keys>                Press a key or chord, e.g. ArrowRight, Meta+F
  type <text>                 Type text into the focused element
  select-text <selector>      Drag across the first matching element to select its text
  hover <selector>            Move the mouse over the first matching element

Inspection and evidence
  snapshot                    Print the accessibility tree of the page
  screenshot <file.png>       Save a screenshot of the page
  wait <selector> [state]     Wait for visible (default), hidden, attached, or detached
  eval <expression>           Evaluate a read-only expression in the page and print JSON
  console                     Print and clear page console messages and errors
  sql <query>                 Query the app's SQLite database read-only
  logs                        Print the end of the app log

Native dialogs
  dialog open-file <path>     Answer the next file dialog with a path
  dialog confirm <accept|cancel>
                              Answer the next confirmation
  dialog last                 Print the last dialog the app showed
`

// hostCommand is the hidden command the CLI re-executes itself with to run
// the long-lived host process.
const hostCommand = "__host"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	err := run(ctx, os.Args[1:])
	stop()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	command := "help"
	if len(args) > 0 {
		command, args = args[0], args[1:]
	}
	if command == "help" || command == "--help" || command == "-h" {
		fmt.Print(usage)
		return nil
	}
	paths, err := resolvePaths()
	if err != nil {
		return err
	}
	switch command {
	case "install":
		return install()
	case "build":
		return build(ctx, paths)
	case "start":
		return start(ctx, paths, args)
	case "stop":
		return stopInstance(ctx, paths)
	case "doctor":
		return doctor(ctx, paths)
	case "info":
		return printInfo(paths)
	case "dialog":
		return dialog(paths, args)
	case "sql":
		return query(ctx, paths, args)
	case "logs":
		return printLogs(paths)
	case hostCommand:
		return runHost(ctx, paths)
	}
	if !isHostCommand(command) {
		return fmt.Errorf("unknown command %q. Run `go tool verify-glint help`", command)
	}
	output, err := sendToHost(ctx, paths, command, args)
	if err != nil {
		return err
	}
	fmt.Println(output)
	return nil
}

var errNotRunning = errors.New("glint is not running. Run `go tool verify-glint start` first")
