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

## Driving it with verify-glint

```bash
bin/verify-glint press ArrowRight
bin/verify-glint click button "Save page 2"
bin/verify-glint sql "select page_number, cfi, progress from book_bookmarks"     # 2||0.0
bin/verify-glint snapshot          # the button becomes "Remove bookmark from page 2"

# jump from the list
bin/verify-glint press ArrowLeft
bin/verify-glint click button "Open bookmarks"
bin/verify-glint click button "Go to bookmarked page 2"

# remove
bin/verify-glint click button "Remove bookmark from page 2"
bin/verify-glint sql "select count(*) from book_bookmarks"

# persistence
bin/verify-glint restart-app
bin/verify-glint click button "/Continue generated-reader/"
bin/verify-glint click button "Open bookmarks"
bin/verify-glint snapshot
```

## Gotchas

- Button names include the page number, so they change when the page changes. Read the current name with `snapshot` before clicking.
- With the list open, "Remove bookmark from page N" exists both in the top bar and in the list. `click` presses the first match, the one in the top bar.
- Arrow key direction depends on the binding (see [pdf-reader](pdf-reader.md)). The steps above assume left binding, the default.
- PDF bookmarks have an empty `cfi` and `progress` 0. EPUB bookmarks have both set.
- The list panel stays open. Close it with "Close panel" before checking another panel.
