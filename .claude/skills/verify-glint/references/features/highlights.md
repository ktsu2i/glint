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

## Driving it with verify-glint

```bash
# create
bin/verify-glint select-text ".text-layer[data-page='1'] span"   # prints the selected text
bin/verify-glint click button "Highlight in yellow"
bin/verify-glint wait ".highlight-mark.is-yellow"
bin/verify-glint sql "select page_number, color, text, cfi = '' as is_pdf, rects <> '' as has_rects from book_highlights"

# change color
bin/verify-glint mouse-click ".highlight-mark.is-yellow"
bin/verify-glint click button "Change to pink"
bin/verify-glint wait ".highlight-mark.is-pink"

# list
bin/verify-glint click button "Open highlights"
bin/verify-glint snapshot          # listitems inside complementary "Highlights"
bin/verify-glint click button "Go to the highlight on page 1"

# persistence
bin/verify-glint restart-app
bin/verify-glint click button "/Continue generated-reader/"
bin/verify-glint wait ".highlight-mark.is-pink"
```

## Gotchas

- `.highlight-mark` sits under the text layer, so `click-css` gets intercepted by the text layer. Use `mouse-click` to select an existing highlight (the app looks up the highlight at the clicked point).
- `select-text` drags from the left edge to the right edge of one element. Selecting across lines is not supported by the driver yet.
- A PDF highlight has `rects` and an empty `cfi`; an EPUB highlight is the opposite. Check with `sql` that exactly one of them is set.
- Color is user-visible evidence, so keep a `screenshot` in addition to `sql`.
