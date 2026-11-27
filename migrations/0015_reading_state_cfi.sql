-- The exact place an EPUB was left, as an EPUB CFI inside the section kept in
-- page_number. PDFs keep an empty CFI.
ALTER TABLE book_reading_states ADD COLUMN cfi TEXT NOT NULL DEFAULT '';

-- Which side a PDF is bound on, so a spread reads left to right or right to left.
ALTER TABLE book_reading_states ADD COLUMN binding_direction TEXT NOT NULL DEFAULT 'ltr'
    CHECK (binding_direction IN ('ltr', 'rtl'));
