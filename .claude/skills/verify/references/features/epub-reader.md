# EPUB reader

The reader that renders EPUBs with foliate-js: paginated sections, the table of contents, page turns, text size and spreads, restoring the reading position, highlights and bookmarks located by CFI, and stripping active content from the book.

Use `frontend/testdata/generated-reader.epub`. It has a cover, a nav document, and three chapters long enough to span several pages. Chapter 2 deliberately carries active content: a `<script>`, an `onclick` handler on `#active-handler`, and a `javascript:` link on `#active-link`. Each would set a `data-epub-*-ran` attribute on the root element if it ever ran.

## Sub-features

- open: importing an EPUB opens it at the first section; Go parses it, extracts the text into one `book_segments` row per spine item, and extracts the cover
- page-turn: "Previous page" / "Next page" and the arrow keys; the bottom bar shows overall progress as a percentage
- toc: "Open table of contents" lists the nav entries; picking one jumps there and closes the panel
- slider: "Reading progress" picks a position; saved bookmarks are marked on it
- view-menu: "View" switches "Single page" / "Spread" and the text size ("Smaller text", "Larger text", "Default")
- reading-position: the CFI of the current page is saved, and the book reopens there
- highlights: select text in the page, pick a color; stored with a CFI and empty rects (`[]`)
- bookmarks: "Bookmark this page" / "Remove the bookmark from this page"; stored with the page-start CFI and `progress`
- lists: bookmarks and highlights are listed per chapter ("Go to the bookmark in <chapter>", "Remove the highlight in <chapter>")
- active-content: scripts, `on*` attributes, and `javascript:` URLs in the book are stripped before rendering, and the production CSP blocks scripts as well

## How to get to it (user POV)

Import an `.epub` from the library, or click its card or "Continue".

## Driving it with go tool verify

The book's pages live in a frame inside a closed shadow root. Page selectors and `snapshot` cannot see into it; pass `--in-book` as the first argument of `click-css`, `mouse-click`, `right-click`, `hover`, `select-text`, `snapshot`, `wait`, or `eval` to act inside the current section's frame.

```bash
# open
go tool verify dialog open-file frontend/testdata/generated-reader.epub
go tool verify click button "Add Book"
go tool verify wait --in-book "h1"
go tool verify snapshot --in-book                 # the section's headings and paragraphs
go tool verify sql "select title, format, page_count, cover_thumbnail_status from books"     # epub, 3 sections
go tool verify sql "select ordinal, kind, location, heading_path from book_segments"         # section, spine:0..2

# active content is stripped and never runs
go tool verify click button "Open table of contents"
go tool verify click button "Chapter 2: Active Content"
go tool verify wait --in-book "#active-handler"
go tool verify eval --in-book "({ scripts: document.querySelectorAll('script').length, onclick: document.getElementById('active-handler')?.getAttribute('onclick') ?? null, href: document.getElementById('active-link')?.getAttribute('href') ?? null, ran: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-epub-')) })"
go tool verify click-css --in-book "#active-handler"
go tool verify eval --in-book "document.documentElement.getAttribute('data-epub-handler-ran')"   # null

# page turns and progress
go tool verify press ArrowRight
go tool verify snapshot                           # the percentage in the bottom bar goes up

# highlight: select on the visible page, then pick a color
go tool verify press ArrowLeft
go tool verify select-text --in-book "#active-handler"    # prints the selected text
go tool verify click button "Highlight in green"
go tool verify sql "select page_number, color, text, cfi <> '' as has_cfi, rects from book_highlights"   # rects is []
go tool verify mouse-click --in-book "#active-handler"    # selects the existing highlight
go tool verify click button "Change to purple"

# bookmark
go tool verify click button "Bookmark this page"
go tool verify sql "select page_number, cfi <> '' as has_cfi, progress from book_bookmarks"

# text size (an app-wide setting)
go tool verify click button "View"
go tool verify click button "Larger text"
go tool verify press Escape
go tool verify sql "select key, value from app_settings where key like 'reader.epub%'"

# persistence: position, highlight, bookmark, and text size survive a restart
go tool verify restart-app
go tool verify click button "/Continue generated-reader/"
go tool verify wait --in-book "#active-handler"
go tool verify screenshot /path/to/epub-after-restart.png

# lists
go tool verify click button "Open bookmarks"
go tool verify click button "/Go to the bookmark in/"
go tool verify click button "/Remove the bookmark in/"
go tool verify click button "Open highlights"
go tool verify click button "/Remove the highlight in/"
```

## Gotchas

- Check active content in this server-mode build, not in `go tool wails3 dev`. The Vite dev server does not apply the production CSP.
- Wait for `--in-book` content (`wait --in-book "h1"`) before acting on it. The frame is created after the book opens and is replaced when the section changes.
- Only elements on the visible page can be selected or clicked. After a page turn, an element on the previous page is off-screen and `select-text` returns `""`. Go back to its page first.
- Highlights are drawn by foliate-js outside the section frame, so `eval --in-book` cannot find them. Use `screenshot` for the color and `sql` for the stored row.
- An EPUB highlight has a CFI and `rects` of `[]`; a PDF highlight has rects and an empty CFI.
- Turning pages with the keyboard hides the top and bottom bars. The buttons stay in the accessibility tree and still respond to `click`, but screenshots show no bars. `Escape` toggles them when nothing is selected.
- Picking a table of contents entry closes the panel, so there is no "Close panel" to press afterwards.
- The bottom bar shows overall progress, not a page number, and it changes with the text size and the spread setting. Compare progress with the same settings.
- Text size and spread are app-wide settings (`app_settings`), not per book, and persist across books and restarts.
- The EPUB view menu has no binding option. Page direction comes from the book itself.
