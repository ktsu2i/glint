# Highlights

Coloring selected text. PDF highlights are located by on-page rectangles (`rects`), EPUB highlights by CFI.

## Sub-features

- create: selecting text shows the "Highlight the selection" toolbar; "Highlight in yellow / green / pink / purple" creates the highlight
- activate: clicking an existing highlight shows the "Highlight" toolbar
- change-color: "Change to <color>"
- remove: "Remove highlight" in the toolbar, or "Remove the highlight on page N" in the list
- list: "Open highlights" opens the list; "Go to the highlight on page N" jumps to it
- persistence: highlights survive reopening the book and restarting the app

## How to get to it (user POV)

Drag across text in the reader. The list opens from "Open highlights" in the top bar.

## Driving it with go tool verify

```bash
# create
go tool verify select-text ".text-layer[data-page='1'] span"   # prints the selected text
go tool verify click button "Highlight in yellow"
go tool verify wait ".highlight-mark.is-yellow"
go tool verify sql "select page_number, color, text, cfi = '' as is_pdf, rects <> '[]' as has_rects from book_highlights"

# change color
go tool verify mouse-click ".highlight-mark.is-yellow"
go tool verify click button "Change to pink"
go tool verify wait ".highlight-mark.is-pink"

# list
go tool verify click button "Open highlights"
go tool verify snapshot          # listitems inside complementary "Highlights"
go tool verify click button "Go to the highlight on page 1"

# persistence
go tool verify restart-app
go tool verify click button "/Continue generated-reader/"
go tool verify wait ".highlight-mark.is-pink"
```

## Gotchas

- `.highlight-mark` sits under the text layer, so `click-css` gets intercepted by the text layer. Use `mouse-click` to select an existing highlight (the app looks up the highlight at the clicked point).
- `select-text` drags from the left edge to the right edge of one element. Selecting across lines is not supported by the driver yet.
- A PDF highlight has `rects` and an empty `cfi`; an EPUB highlight has a `cfi` and `rects` of `[]`. Check with `sql` that exactly one of them is set.
- These steps are for PDFs. For EPUBs, select inside the book frame with `--in-book`; see [epub-reader](epub-reader.md).
- Highlights are drawn only on rendered pages, and a reopened book starts at the saved reading position. After `restart-app`, go to the highlight's page (or start from page 1) before waiting for `.highlight-mark`.
- Color is user-visible evidence, so keep a `screenshot` in addition to `sql`.
