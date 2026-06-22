CREATE TABLE IF NOT EXISTS book_pages (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    text TEXT NOT NULL DEFAULT '',
    width REAL NOT NULL DEFAULT 0,
    height REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE (book_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_book_pages_book_page
    ON book_pages(book_id, page_number);
