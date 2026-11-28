# Book search

Full-text search within the open book, in both readers. It searches `book_segments` (pages for PDF, sections for EPUB) through the FTS5 trigram table, and falls back to `LIKE` for terms shorter than three characters.

## Sub-features

- open: "Search this book" in the top bar, or ⌘F, opens the "Text search" panel with the search box focused; ⌘F again closes it
- query: type terms and press Enter or "Search". "Search" is disabled while the box is blank. The box accepts up to 200 characters
- matching: case-insensitive and NFKC-normalized; every term must appear in the same page or section (AND); terms shorter than three characters still match
- results: "Found on N pages", then one entry per page or section with its match count and an excerpt with the terms marked; at most 50 entries
- jump: "Go to page N" (PDF) or "Go to <chapter title>" (EPUB) moves the reader there and marks that entry as active
- empty: a query with no hits shows "“<query>” was not found."

## How to get to it (user POV)

Open a book, then click the magnifying glass in the top bar or press ⌘F.

## Driving it with go tool verify

```bash
# PDF
go tool verify dialog open-file frontend/testdata/generated-reader.pdf
go tool verify click button "Add Book"
go tool verify wait ".text-layer[data-page='1'] span"
go tool verify sql "select count(*) from book_segments"        # equals page_count before searching
go tool verify press Meta+F
go tool verify eval "document.activeElement?.getAttribute('aria-label')"   # "Search this book"
go tool verify type selection
go tool verify press Enter
go tool verify snapshot          # "Found on 2 pages", "Go to page 1", "Go to page 2", marks on "selection"
go tool verify click button "Go to page 2"
go tool verify eval "document.querySelector('[aria-label=\"Go to page\"]')?.textContent"   # "2 / 3"

# another query: clear the box, type, press Enter
go tool verify click-css "input[type=search]"
go tool verify press Meta+A
go tool verify press Backspace
go tool verify type "CONTEXT budget"   # case-insensitive, both terms on page 1
go tool verify press Enter

# EPUB results are sections
go tool verify dialog open-file frontend/testdata/generated-reader.epub
go tool verify click button "Add Book"
go tool verify wait --in-book "h1"
go tool verify click button "Search this book"
go tool verify click-css "input[type=search]"
go tool verify type "event handler"
go tool verify press Enter
go tool verify click button "/Go to Chapter 2/"
go tool verify wait --in-book "#active-handler"
```

Useful queries against the generated books:

| Query | Book | Expected |
|---|---|---|
| `selection` | PDF | pages 1 and 2 |
| `CONTEXT budget` | PDF | page 1 (case folding, AND) |
| `budget evidence` | PDF | not found (the terms are on different pages) |
| `is` | PDF | page 3 (a short term through `LIKE`) |
| `trimContext(selection` | PDF | page 1 (punctuation in a term) |
| `zebra` | PDF | not found |
| `event handler` | EPUB | "Chapter 2: Active Content" |

## Gotchas

- Search only finds text that has been indexed. For PDFs the frontend extracts text after the book opens, so check that `book_segments` has as many rows as `page_count` before concluding a search is broken. EPUB text is indexed in Go during import.
- Jumping to a result goes to the page (PDF) or the start of the section (EPUB). It does not scroll to or select the match inside the page.
- Clearing the box does not clear the previous results: with a blank box, "Search" is disabled and Enter does nothing.
- To run another query, clear the box first (`Meta+A`, then `Backspace`); `type` appends to what is already there.
- The count text is not pluralized ("1 matches", "Found on 1 pages"), and EPUB results also say "pages" although each entry is a section. This is the current copy; update this line if it changes.
- The panel stays open while you turn pages. Close it with "Close panel" or ⌘F.
