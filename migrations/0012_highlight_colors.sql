-- Blue is kept for the text selection, so blue highlights become purple.
CREATE TABLE book_highlights_next (
    id INTEGER PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    color TEXT NOT NULL CHECK (color IN ('yellow', 'green', 'pink', 'purple')),
    text TEXT NOT NULL CHECK (text <> ''),
    -- JSON array of {x, y, width, height}, as fractions of the page size.
    rects TEXT NOT NULL,
    created_at TEXT NOT NULL
);

INSERT INTO book_highlights_next (id, book_id, page_number, color, text, rects, created_at)
SELECT id,
       book_id,
       page_number,
       CASE color WHEN 'blue' THEN 'purple' ELSE color END,
       text,
       rects,
       created_at
  FROM book_highlights;

DROP TABLE book_highlights;
ALTER TABLE book_highlights_next RENAME TO book_highlights;

CREATE INDEX idx_book_highlights_book_page
    ON book_highlights(book_id, page_number, id);
