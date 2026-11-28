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

## Driving it with glint-driver

```bash
# import (success)
node frontend/scripts/glint-driver.mjs dialog open-file frontend/testdata/generated-reader.pdf
node frontend/scripts/glint-driver.mjs click button "Add Book"
node frontend/scripts/glint-driver.mjs wait ".text-layer[data-page='1'] span"
node frontend/scripts/glint-driver.mjs dialog last          # open-file / Add a book to the library
node frontend/scripts/glint-driver.mjs sql "select title, format, page_count, cover_thumbnail_status from books"
node frontend/scripts/glint-driver.mjs sql "select count(*) from book_segments"

# import cancelled: click without writing an answer. No book is added
node frontend/scripts/glint-driver.mjs click button "Add Book"

# continue reading
node frontend/scripts/glint-driver.mjs click button "Library"
node frontend/scripts/glint-driver.mjs click button "/Continue generated-reader/"

# remove (cancel first, then accept)
node frontend/scripts/glint-driver.mjs right-click article
node frontend/scripts/glint-driver.mjs dialog confirm cancel
node frontend/scripts/glint-driver.mjs click menuitem "Remove from Library"
node frontend/scripts/glint-driver.mjs sql "select count(*) from books"        # still 1
node frontend/scripts/glint-driver.mjs right-click article
node frontend/scripts/glint-driver.mjs dialog confirm accept
node frontend/scripts/glint-driver.mjs click menuitem "Remove from Library"
node frontend/scripts/glint-driver.mjs wait article detached
node frontend/scripts/glint-driver.mjs sql "select (select count(*) from books), (select count(*) from book_highlights), (select count(*) from book_bookmarks)"
```

To sort, click "Sort books: …", read the item names with `snapshot`, then pick one. Check the card order with `snapshot`.

## Gotchas

- Imported books are copied into the data directory (`home/Library/Application Support/Glint/books/<id>/`). Deleting the original file does not make the book "File not found". To get a missing file, delete the copy instead.
- Importing the same file again does not add a book; it opens the existing one (`file_hash` is unique).
- The card menu is a context menu opened by right-click. `hover` does not show it.
- The cover and the text index are built asynchronously after the book opens. Do not conclude while `cover_thumbnail_status` is `pending`; wait for `ready` or `failed`.
- `dialog last` only remembers the most recent dialog. Read it right after the action you want to check.
