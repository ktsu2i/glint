# Library search

Search across every book in the library, from the library screen. Titles are matched in the frontend as you type; text is searched in `book_segments` across all books, debounced while typing.

## Sub-features

- open: "Search the library (⌘F)" in the top bar, or ⌘F on the library screen, opens the "Search the library" region with the "Search query" box focused; Escape closes it
- titles: the "Titles" section lists books whose display title contains every term (case-insensitive, NFKC); each entry opens the book ("Open <title>"), or offers to choose the file again when it is missing
- text: the "Text" section lists books whose indexed text matches, with "Matches in N books", per-book match counts, and up to 3 pages or sections per book with excerpts and marked terms; at most 30 books
- jump: "Open <title> at page N" opens the book at that page (PDF) or at the start of section N (EPUB)
- empty: "No books contain “<query>”."; a blank box shows the prompt again
- matching: the same rules as [book-search](book-search.md): case-insensitive, all terms in the same page or section, short terms through `LIKE`

## How to get to it (user POV)

On the library screen, click the magnifying glass in the top bar or press ⌘F.

## Driving it with go tool verify

Import both generated books first. They are both titled `generated-reader` (titles come from the file name), so rename one to tell them apart in results. Renaming is also part of the [library](library.md) feature.

```bash
go tool verify dialog open-file frontend/testdata/generated-reader.pdf
go tool verify click button "Add Book"
go tool verify wait ".text-layer[data-page='1'] span"
go tool verify click button "Library"
go tool verify dialog open-file frontend/testdata/generated-reader.epub
go tool verify click button "Add Book"
go tool verify wait --in-book "h1"
go tool verify click button "Library"

# rename the EPUB (the most recently opened card comes first)
go tool verify right-click "article >> nth=0"
go tool verify click menuitem "Rename"
go tool verify press Meta+A
go tool verify type "Reader EPUB"
go tool verify press Enter
go tool verify sql "select format, title, display_name from books"

# text matches in both books
go tool verify press Meta+F
go tool verify eval "document.activeElement?.getAttribute('aria-label')"   # "Search query"
go tool verify type context
go tool verify wait "role=button[name='Open generated-reader at page 1']"
go tool verify snapshot          # status "Matches in 2 books", entries per book with marked excerpts

# jump to a result
go tool verify press Meta+A
go tool verify type evidence
go tool verify wait "role=button[name='Open Reader EPUB at page 3']"
go tool verify click button "Open Reader EPUB at page 3"
go tool verify wait --in-book "h1"
go tool verify snapshot          # "Chapter 3: Evidence" in the top bar

# title match without a text match
go tool verify click button "Library"
go tool verify press Meta+F
go tool verify type EPUB
go tool verify wait "text=No books contain “EPUB”"
go tool verify snapshot          # region "Titles" with "Open Reader EPUB"

# no results, then clear, then close
go tool verify press Meta+A
go tool verify type zebra
go tool verify wait "text=No books contain “zebra”"
go tool verify press Meta+A
go tool verify press Backspace
go tool verify press Escape
```

## Gotchas

- Text results arrive 250 ms after typing stops, and the previous results stay on screen until then. Always wait for something that names the new query or its result (`wait "text=No books contain “zebra”"`, or a specific "Open <title> at page N" button). Waiting for a generic element can match the previous query's results.
- Title matches update immediately and only look at titles (or display names), not text. A query can show a title match and "No books contain" at the same time.
- Text search needs indexed text. A PDF is indexed by the frontend after it opens, so open each PDF once and check `book_segments` before searching.
- Both generated books are titled `generated-reader`. Without a rename, result buttons have the same names and `click` picks the first one.
- Leaving the library screen clears the search; ⌘F starts with an empty box.
- For EPUBs, "page N" in result labels is the section number, and the jump lands at the start of that section.
- The EPUB section text currently includes the document's `<title>` as well as its heading (text extraction skips only `script` and `style`), so a heading word appears twice in excerpts and counts. This is the current indexing; update this line if it changes.
- Count texts are not pluralized ("1 matches"), as in book search.
