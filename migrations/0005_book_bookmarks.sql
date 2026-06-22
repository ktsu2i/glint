CREATE TABLE IF NOT EXISTS book_bookmarks (
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (book_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_book_bookmarks_book_page
    ON book_bookmarks(book_id, page_number);
