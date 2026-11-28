# Glint feature map

A behavior-level inventory of Glint. Agents use it to decide what to drive and what counts as evidence. Humans use it as the regression checklist.

## Baseline preconditions

- `doctor` reports `doctor: ok`.
- Start from the empty library right after `start`. Do not carry data over from an earlier run (`stop` deletes it).
- The UI language is English (the driver opens the page with `en-US`). To check Japanese, switch the setting first.
- Use the generated books in `frontend/testdata`: `generated-reader.pdf` (3 pages, each with a heading, two lines of body text, and one line of code) and `generated-reader.epub` (3 chapters spanning several pages, with active content in chapter 2), and `generated-reader-drm.epub` (the same book marked as encrypted, which import must refuse). Never use copyrighted or personal books.

## Coverage and gap reporting

The feature file for the change defines what to cover.

- When there are several entry points (buttons, keys, menus, jumps from a list), drive all of them.
- Drive the success, cancel, error, empty, and persistence paths the change can affect. Check persistence with both `sql` and `restart-app`.
- When a path is unreachable, name it, say why (native UI, OS, or driver), and cover the closest path that remains.

## Full sweep

For a broad regression, walk this list top to bottom. Keep new entries behavior-level, grounded in selectors or visible state, and short enough to run without reading source.

- [library](library.md): import, import errors, choosing a missing file again, sort, rename, remove, covers, continue reading
- [library-search](library-search.md): search titles and text across the library, jumping into a book
- [pdf-reader](pdf-reader.md): page turns, go to page, slider, view settings (binding, zoom), restoring the reading position
- [epub-reader](epub-reader.md): EPUB sections, table of contents, page turns, text size and spreads, position, highlights and bookmarks by CFI, stripping active content
- [book-search](book-search.md): search within a book, matching rules, jumping to results, for PDF and EPUB
- [highlights](highlights.md): create from a selection, change color, remove, jump from the list
- [bookmarks](bookmarks.md): save and remove a page, jump and remove from the list
- [settings](settings.md): display theme and interface language, and translated messages

Not written yet: read-aloud and multi-feature journeys.

## Entry contract

Every feature file uses the same four H2s:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with go tool verify`
4. `Gotchas`
