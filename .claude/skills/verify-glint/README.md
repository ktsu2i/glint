# verify-glint

[日本語](README.ja.md)

A skill for running Glint and proving that a change works, with evidence. It drives a server-mode build of Glint in Playwright WebKit, one step at a time, and uses screenshots, the accessibility tree, SQLite rows, and the state after an app restart as evidence.

- `SKILL.md`: instructions for agents
- `references/features/`: the feature map, a behavior-level inventory of what to drive and what to check
- `cmd/verify-glint`: the driver, run as `go tool verify-glint`

## Setup

Once:

```bash
(cd frontend && pnpm install --frozen-lockfile)
go tool verify-glint install    # downloads the Playwright driver and WebKit
```

`start` builds the app for you.

## Using it

### Ask an agent

After changing UI or persisted behavior, ask "verify this with verify-glint", or use `/verify-glint` in Claude Code. The skill is also listed in AGENTS.md, so agents may use it on their own. `.agents/skills/verify-glint` links to this directory for other agents.

The agent reads the relevant feature file, runs `start` and `doctor`, drives the entry points and paths listed there, collects evidence, reports anything unreachable with the reason, and runs `stop`.

Examples:

- "I fixed changing a highlight's color. Verify it with verify-glint, including after a restart."
- "Walk the whole verify-glint feature map and check for regressions."
- "Add epub-reader to the verify-glint feature map, and check each step against the running app."

### Run the driver yourself

Run it from anywhere inside the repository. Relative paths you pass, such as a book file, are resolved from the current directory.

```bash
go tool verify-glint start          # rebuild if the sources are newer, then start on an empty library
go tool verify-glint doctor         # check for "doctor: ok"
go tool verify-glint snapshot       # accessibility tree; shows the names of buttons you can click

go tool verify-glint dialog open-file frontend/testdata/generated-reader.pdf   # answer for the next file dialog
go tool verify-glint click button "Add Book"
go tool verify-glint wait ".text-layer[data-page='1'] span"
go tool verify-glint screenshot /tmp/reader.png
go tool verify-glint sql "select title, page_count from books"

go tool verify-glint restart-app    # restart only the app on the same data
go tool verify-glint stop           # stop everything and delete the data
```

The loop is: read names with `snapshot`, act with `click`, wait for the result with `wait`, and check it with `screenshot` or `sql`. `go tool verify-glint help` lists every command.

## What each command verifies

### Lifecycle

| Command | Verifies |
|---|---|
| `install` | Nothing; downloads the Playwright driver and WebKit once |
| `start` | The current sources build, the app starts, migrations apply, and the empty library shows |
| `doctor` | Whether results can be trusted: the build is newer than the sources, the driver and binary have not changed since start, the app answers, and no unused dialog answer is left |
| `info` | Where the instance under test lives: URL, database, logs (attach to reports) |
| `restart-app` | **State survives an app restart**: highlights, bookmarks, reading position, settings. Catches missing saves, broken loading on startup, and migration problems |
| `stop` | Nothing; cleanup only |

### Input (the same path a user takes)

| Command | Verifies |
|---|---|
| `click <role> <name>` | A button or menu item is exposed with that accessible name and can be pressed. A timeout is itself evidence of failure |
| `click-css` | Behavior of elements without a role (cards, the text layer) |
| `mouse-click` | UI that hit-tests by coordinates (selecting an existing highlight) |
| `right-click` | Contents and actions of context menus |
| `press` | Keyboard shortcuts and keys: page turns, direction reversed by binding, Escape to close, ⌘F |
| `type` | Input fields: going to a page number, search terms, renaming |
| `select-text` | Text can be selected (the text layer lines up). Prints the selected text |
| `hover` | Hover UI: slider previews, tooltips |
| `open` / `reload` | Starting from a given URL, or reloading so only frontend state is lost while the app keeps running |

### Inspection and evidence

| Command | Verifies | Limits |
|---|---|---|
| `snapshot` | Structure and state: what is shown, button names, `[pressed]` and `[disabled]`, list item counts, open panels. Also exposes accessibility gaps such as unnamed buttons | No color or layout. Does not include the EPUB iframe |
| `screenshot` | Appearance: highlight colors, zoom, spreads, binding, broken layout | Needs to be looked at |
| `wait <selector> [state]` | An asynchronous result appears or disappears (`detached`) | A timeout is evidence of failure |
| `eval <expr>` | Fine DOM details: current page text, the selection, attributes | Read-only. Never call app functions in place of the user action |
| `console` | No JS errors or warnings during the actions | Wails, PDF.js, and post-restart WebSocket warnings are expected |
| `sql <query>` | **Persisted data is right**: rows exist, values (color, page, exactly one of `rects` and `cfi`), cascading deletes, cover and index status | Read-only |
| `logs` | Errors on the Go side: failed binding calls, parse errors | |

### Dialogs

| Command | Verifies |
|---|---|
| `dialog open-file <path>` | The success path of file dialogs: import, choosing the file again |
| (act without an answer) | The cancel path: nothing changes |
| `dialog confirm accept / cancel` | Both outcomes of a confirmation: removed or kept |
| `dialog last` | **A dialog was actually shown**, with its kind and title. Also shows when one appeared where it should not |

### Combining commands

One command alone is weak evidence. Combine them:

- **Persistence:** act → check the row with `sql` → `restart-app` → check it on screen. For example, a highlight is saved and still drawn after a restart.
- **Removal:** `dialog confirm cancel` → nothing changes → `accept` → `sql` shows related rows are gone too.
- **Keys:** `press` → read the current page with `eval` → change the binding and repeat.
- **Asynchronous work:** import → `wait` → `sql` shows `cover_thumbnail_status` is `ready` and the `book_segments` count matches the page count.
- **No errors:** `console` and `logs` after a series of actions.

## Out of reach

- Native parts: the window, title bar, full screen, menu bar, settings window, drag and drop from Finder, Sparkle, read-aloud audio
- WKWebView-only differences (Playwright WebKit is close but not identical)
- Performance numbers (there is no stable way to measure them yet)
- Selecting text across lines (`select-text` stays within one element)

When a change touches these, report them as gaps and check the real app with `go tool wails3 dev`.

## Notes

- Your own library is never touched. Data lives in `$TMPDIR/glint-verify-…` and `stop` deletes it.
- Native dialogs do not appear. Write the answer first with `dialog open-file <path>` or `dialog confirm accept|cancel`. With no answer, the dialog is cancelled.
- After changing code, `stop` and then `start`. A stale instance makes `doctor` report `STALE BUILD` or `STALE DRIVER`.
- Use `frontend/testdata/generated-reader.pdf` as the book. If you try your own books, keep them out of the feature map and tests.

## Maintaining the feature map

- When you add a feature or change the UI, update the matching feature file in the same PR, in English, with the same four headings.
- Files not written yet (epub-reader, search, read-aloud, settings, journeys) are added as those features need verification.
