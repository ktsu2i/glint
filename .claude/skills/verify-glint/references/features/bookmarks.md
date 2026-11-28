# Bookmarks

Saving a page to come back to it. PDF bookmarks store the page number; EPUB bookmarks store the CFI of the page start and the position within the whole book (`progress`).

## Sub-features

- save: "Save page N" in the top bar saves the current page
- unsave: on a saved page the same button becomes "Remove bookmark from page N" and removes it
- list: "Open bookmarks" opens the list; "Go to bookmarked page N" jumps to it
- slider-mark: saved pages are also marked on the slider ("Go to page N, bookmarked")
- persistence: bookmarks survive reopening the book and restarting the app

## How to get to it (user POV)

The bookmark button on the right of the reader's top bar. The list opens from "Open bookmarks" on the left.

## Driving it with glint-driver

```bash
node frontend/scripts/glint-driver.mjs press ArrowRight
node frontend/scripts/glint-driver.mjs click button "Save page 2"
node frontend/scripts/glint-driver.mjs sql "select page_number, cfi, progress from book_bookmarks"     # 2||0.0
node frontend/scripts/glint-driver.mjs snapshot          # the button becomes "Remove bookmark from page 2"

# jump from the list
node frontend/scripts/glint-driver.mjs press ArrowLeft
node frontend/scripts/glint-driver.mjs click button "Open bookmarks"
node frontend/scripts/glint-driver.mjs click button "Go to bookmarked page 2"

# remove
node frontend/scripts/glint-driver.mjs click button "Remove bookmark from page 2"
node frontend/scripts/glint-driver.mjs sql "select count(*) from book_bookmarks"

# persistence
node frontend/scripts/glint-driver.mjs restart-app
node frontend/scripts/glint-driver.mjs click button "/Continue generated-reader/"
node frontend/scripts/glint-driver.mjs click button "Open bookmarks"
node frontend/scripts/glint-driver.mjs snapshot
```

## Gotchas

- Button names include the page number, so they change when the page changes. Read the current name with `snapshot` before clicking.
- With the list open, "Remove bookmark from page N" exists both in the top bar and in the list. `click` presses the first match, the one in the top bar.
- Arrow key direction depends on the binding (see [pdf-reader](pdf-reader.md)). The steps above assume left binding, the default.
- PDF bookmarks have an empty `cfi` and `progress` 0. EPUB bookmarks have both set.
- The list panel stays open. Close it with "Close panel" before checking another panel.
