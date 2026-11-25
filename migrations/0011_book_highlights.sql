CREATE TABLE book_highlights (
    id INTEGER PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    color TEXT NOT NULL CHECK (color IN ('yellow', 'green', 'blue', 'pink')),
    text TEXT NOT NULL CHECK (text <> ''),
    -- JSON array of {x, y, width, height}, as fractions of the page size.
    rects TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_book_highlights_book_page
    ON book_highlights(book_id, page_number, id);
