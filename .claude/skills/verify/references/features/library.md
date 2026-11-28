# Library

The bookshelf screen: importing books, sorting, renaming, removing, covers, and continuing a book.

## Sub-features

- import: choose a file from "Add Book" (also "Choose Book" when the library is empty), import it, and open it in the reader right away
- recently-opened: the last opened book appears under "Recently opened"; "Continue" opens it where it was left
- book-card: each card under "Imported books". Clicking opens the book. Shows progress such as `2 / 3 pages`
- sort: the "Sort books: …" menu switches between Recently Opened, Date Added, Title, and Reading Progress
- book-menu: right-click a card for Rename, Choose File Again… (only when the file is missing), and Remove from Library
- remove: removes the book after a confirmation, together with its highlights, bookmarks, reading position, and text index
- cover: after import, a cover is generated from the first PDF page and shown on the card
- import-errors: an unsupported file, a PDF without a PDF header, and a DRM-protected EPUB are refused with a message in the library; nothing is added
- broken-pdf: a file with a PDF header but a broken body is imported, then fails to open in the reader
- relink: when a book's stored file is missing, its card shows "File not found" and "Choose the file for <title> again"; choosing a file of the same format restores it, a different format is refused

## How to get to it (user POV)

It is the first screen when the app starts. From the reader, "Library" at the top left goes back.

## Driving it with go tool verify

```bash
# import (success)
go tool verify dialog open-file frontend/testdata/generated-reader.pdf
go tool verify click button "Add Book"
go tool verify wait ".text-layer[data-page='1'] span"
go tool verify dialog last          # open-file / Add a book to the library
go tool verify sql "select title, format, page_count, cover_thumbnail_status from books"
go tool verify sql "select count(*) from book_segments"

# import cancelled: click without writing an answer. No book is added
go tool verify click button "Add Book"

# continue reading
go tool verify click button "Library"
go tool verify click button "/Continue generated-reader/"

# remove (cancel first, then accept)
go tool verify right-click article
go tool verify dialog confirm cancel
go tool verify click menuitem "Remove from Library"
go tool verify sql "select count(*) from books"        # still 1
go tool verify right-click article
go tool verify dialog confirm accept
go tool verify click menuitem "Remove from Library"
go tool verify wait article detached
go tool verify sql "select (select count(*) from books), (select count(*) from book_highlights), (select count(*) from book_bookmarks)"
```

```bash
# import errors: an unsupported file, a PDF without a header, a DRM-protected EPUB
mkdir -p "$TMPDIR/glint-bad" && printf 'plain text\n' > "$TMPDIR/glint-bad/notes.txt" && printf 'not a pdf\n' > "$TMPDIR/glint-bad/no-header.pdf"
go tool verify dialog open-file "$TMPDIR/glint-bad/notes.txt"
go tool verify click button "Add Book"
go tool verify snapshot          # alert "Glint can only import PDF or EPUB files."
go tool verify dialog open-file "$TMPDIR/glint-bad/no-header.pdf"
go tool verify click button "Add Book"
go tool verify dialog open-file frontend/testdata/generated-reader-drm.epub
go tool verify click button "Add Book"
go tool verify snapshot          # alert "This EPUB is DRM-protected and cannot be opened."
go tool verify sql "select count(*) from books"        # 0

# a PDF header with a broken body is imported but cannot be read
printf '%%PDF-1.7\nbroken\n' > "$TMPDIR/glint-bad/broken.pdf"
go tool verify dialog open-file "$TMPDIR/glint-bad/broken.pdf"
go tool verify click button "Add Book"
go tool verify snapshot          # region "PDF reader" with alert "Invalid PDF structure.", controls disabled
go tool verify sql "select title, cover_thumbnail_status from books"     # broken|failed

# relink: delete the stored copy, then choose the file again
go tool verify dialog open-file frontend/testdata/generated-reader.pdf
go tool verify click button "Add Book"
go tool verify click button "Library"
go tool verify info              # the database path; books are stored next to it in books/<id>/
rm "<directory of the database>/books/<id>/generated-reader.pdf"
go tool verify reload
go tool verify snapshot          # "File not found", button "Choose the file for generated-reader again"
go tool verify click button "Choose the file for generated-reader again"    # no answer: cancelled, still missing
go tool verify dialog last       # open-file / Choose the book file again
go tool verify dialog open-file frontend/testdata/generated-reader.epub
go tool verify click button "Choose the file for generated-reader again"    # alert: format does not match
go tool verify dialog open-file frontend/testdata/generated-reader.pdf
go tool verify click button "Choose the file for generated-reader again"
go tool verify wait ".text-layer[data-page='1'] span"
```

Switch the language to Japanese in [settings](settings.md) and repeat the error paths to check the translated messages.

To sort, click "Sort books: …", read the item names with `snapshot`, then pick one. Check the card order with `snapshot`.

## Gotchas

- Imported books are copied into the data directory (`home/Library/Application Support/Glint/books/<id>/`). Deleting the original file does not make the book "File not found". To get a missing file, delete the copy instead.
- Importing the same file again does not add a book; it opens the existing one (`file_hash` is unique).
- The card menu is a context menu opened by right-click. `hover` does not show it.
- The cover and the text index are built asynchronously after the book opens. Do not conclude while `cover_thumbnail_status` is `pending`; wait for `ready` or `failed`.
- Errors appear as an `alert` inside the "Library" region and stay until the next action. Read the text with `snapshot`.
- The native file dialog filters to PDF and EPUB, so an unsupported file reaches Glint only by drag and drop in the app. The scripted dialog reaches the same backend check.
- "A PDF without a PDF header" is refused with an untranslated message ("selected file does not contain a PDF header"), also in Japanese, because it is not a sentinel error. This is the current behavior; update this line if it changes.
- A broken PDF with a valid header is added to the library, and the reader shows PDF.js's English message "Invalid PDF structure.", overlapping the book title. Cover generation fails (`failed`) and indexing logs "Book indexing failed" in `console`. This is the current behavior; update this line if it changes.
- While a book's file is missing, there is no "Continue" button for it; use the card's "Choose the file for <title> again".
- `dialog last` only remembers the most recent dialog. Read it right after the action you want to check.
