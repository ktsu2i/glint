---
name: verify
description: "Run Glint and prove a change works with evidence. Drives a server-mode build in WebKit and uses the accessibility tree, screenshots, SQLite rows, and state after an app restart as evidence. Use to verify UI or persisted behavior, to take screenshots or drive the UI, and for broad regression sweeps."
---

# Verify Glint

Build Glint with `-tags 'server verify'` and drive it one step at a time with Playwright WebKit. This checks what unit tests cannot see: the UI, the Wails boundary, SQLite, and restarts, all together.

The driver is `go tool verify <command>` (`cmd/verify`), run from anywhere inside the repository. The output of `help` is the canonical command list. Run `go tool verify install` once to download the Playwright driver and WebKit.

## How it works

- The app runs as an HTTP server without a GUI, and a WebKit page connects to it. It serves the same `frontend/dist` as production, so the production CSP applies.
- The app starts with `HOME` pointed at a temporary directory. The database and copied books live there, and the real library is never touched. `stop` deletes it.
- Native dialogs do not appear. A `verify` build reads answers written beforehand with the `dialog` command (`internal/app/dialogs_verify.go`). Each answer is used once; with no answer, the dialog is cancelled.
- A host process keeps the app and the page alive, so page state carries over between commands.
- State lives in `$TMPDIR/glint-verify-<hash of the repository path>`, so each worktree gets its own instance.

## Quick start

```bash
go tool verify start      # rebuild if the sources are newer, then start
go tool verify doctor     # always check
go tool verify snapshot   # accessibility tree of the current screen

go tool verify dialog open-file frontend/testdata/generated-reader.pdf
go tool verify click button "Add Book"
go tool verify wait ".text-layer[data-page='1'] span"
go tool verify screenshot /path/to/proof.png

go tool verify stop
```

## Command surface

- Lifecycle: `build`, `start`, `stop`, `doctor`, `info`, `restart-app`
- Navigation and input: `open`, `reload`, `click`, `click-css`, `mouse-click`, `right-click`, `press`, `type`, `select-text`, `hover`
- Inspection and evidence: `snapshot`, `screenshot`, `wait`, `eval`, `console`, `sql`, `logs`
- Dialogs: `dialog open-file <path>`, `dialog confirm <accept|cancel>`, `dialog last`

## Proof bar

Do not submit "it opened" or "it showed up" as evidence. Show the result of the same path a user takes, in a form a skeptical reviewer would accept.

- Run `doctor` first. If it reports `STALE BUILD`, `STALE DRIVER`, `STALE INSTANCE`, or an unused dialog answer, fix that before going on. Results from a stale build are not evidence.
- Read the relevant files under `references/features/`, and drive every entry point, mode, and success / cancel / error / empty / persistence path listed there that the change can affect.
- Act through the user path: buttons, keys, menus, and dialogs. Use `eval` only to read state after the user path ran, never to call app functions in place of the user action.
- Verify side effects, not just pixels: rows via `sql`, that a dialog was shown via `dialog last`, and that state survives `restart-app`.
- Record the trigger and the settled end state in the same run.
- When a path is unreachable, name it and the reason (native UI, OS, or driver limits), and cover the closest path that remains.

## Driving conventions

- Find elements by ARIA role and name (`click button "Add Book"`). Use CSS selectors only for elements without a role (`.text-layer`, `.highlight-mark`, and so on).
- When a name contains something variable such as a book title, use a `/regex/` (`click button "/Continue generated-reader/"`).
- Do not wait with fixed sleeps. Use `wait` on a visible end state.
- Prefer registered keys (`press ArrowRight`) over coordinate clicks for things like page turns.
- Use `frontend/testdata/generated-reader.pdf` (3 pages with an outline) as the book. Do not use copyrighted or personal books.
- After changing Go code or `cmd/verify`, `stop` and `start` again.
- These `console` messages are expected: Wails "Browser Environment Detected", PDF.js "Setting up fake worker", and the WebSocket disconnect and reconnect after `restart-app`.

## Out of reach

The driver cannot verify the following. Report them as gaps when relevant.

- The native window: title bar, full screen, remembered window position and size, the application menu
- The settings window: it opens as a separate window and has not been checked yet
- Drag and drop from Finder
- Sparkle updates
- Read-aloud audio itself (the button state can be checked)
- WKWebView-specific differences. Playwright WebKit is close but not identical. When rendering or focus details are in doubt, also look at the real app (`go tool wails3 dev`).

## Feature map

The behavior inventory lives in [`references/features/`](references/features/README.md): one file per feature, each with the same four H2s, `Sub-features`, `How to get to it (user POV)`, `Driving it with go tool verify`, and `Gotchas`. For broad regression sweeps, walk the README top to bottom.

Write the skill and its references in English. Keep `README.md` and `README.ja.md` in this directory in sync; they are for humans.
