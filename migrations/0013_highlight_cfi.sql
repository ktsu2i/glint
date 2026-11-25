-- EPUB pages reflow, so an EPUB highlight is placed by an EPUB CFI instead of
-- rectangles on a page. PDF highlights keep an empty CFI.
ALTER TABLE book_highlights ADD COLUMN cfi TEXT NOT NULL DEFAULT '';
