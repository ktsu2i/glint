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

## How to get to it (user POV)

It is the first screen when the app starts. From the reader, "Library" at the top left goes back.

## Driving it with verify-glint

```bash
# import (success)
go tool verify-glint dialog open-file frontend/testdata/generated-reader.pdf
go tool verify-glint click button "Add Book"
go tool verify-glint wait ".text-layer[data-page='1'] span"
go tool verify-glint dialog last          # open-file / Add a book to the library
go tool verify-glint sql "select title, format, page_count, cover_thumbnail_status from books"
go tool verify-glint sql "select count(*) from book_segments"

# import cancelled: click without writing an answer. No book is added
go tool verify-glint click button "Add Book"

# continue reading
go tool verify-glint click button "Library"
go tool verify-glint click button "/Continue generated-reader/"

# remove (cancel first, then accept)
go tool verify-glint right-click article
go tool verify-glint dialog confirm cancel
go tool verify-glint click menuitem "Remove from Library"
go tool verify-glint sql "select count(*) from books"        # still 1
go tool verify-glint right-click article
go tool verify-glint dialog confirm accept
go tool verify-glint click menuitem "Remove from Library"
go tool verify-glint wait article detached
go tool verify-glint sql "select (select count(*) from books), (select count(*) from book_highlights), (select count(*) from book_bookmarks)"
```

To sort, click "Sort books: …", read the item names with `snapshot`, then pick one. Check the card order with `snapshot`.

## Gotchas

- Imported books are copied into the data directory (`home/Library/Application Support/Glint/books/<id>/`). Deleting the original file does not make the book "File not found". To get a missing file, delete the copy instead.
- Importing the same file again does not add a book; it opens the existing one (`file_hash` is unique).
- The card menu is a context menu opened by right-click. `hover` does not show it.
- The cover and the text index are built asynchronously after the book opens. Do not conclude while `cover_thumbnail_status` is `pending`; wait for `ready` or `failed`.
- `dialog last` only remembers the most recent dialog. Read it right after the action you want to check.
