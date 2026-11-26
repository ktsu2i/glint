-- EPUB pages reflow, so an EPUB bookmark is placed by an EPUB CFI, and a
-- section can hold several bookmarks. PDF bookmarks keep an empty CFI.
-- progress is where the bookmark sits in the book, from 0 to 1, for showing
-- it on the slider; PDF bookmarks keep 0.
CREATE TABLE book_bookmarks_next (
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    cfi TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    created_at TEXT NOT NULL,
    PRIMARY KEY (book_id, page_number, cfi)
);

INSERT INTO book_bookmarks_next (book_id, page_number, created_at)
SELECT book_id, page_number, created_at
  FROM book_bookmarks;

DROP INDEX idx_book_bookmarks_book_page;
DROP TABLE book_bookmarks;
ALTER TABLE book_bookmarks_next RENAME TO book_bookmarks;
