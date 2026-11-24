CREATE TABLE book_pages_new (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    text TEXT NOT NULL DEFAULT '',
    width REAL NOT NULL DEFAULT 0,
    height REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE (book_id, page_number)
);

INSERT INTO book_pages_new (id, book_id, page_number, text, width, height, updated_at)
SELECT id, book_id, page_number, text, width, height, updated_at
  FROM book_pages
 ORDER BY book_id, page_number;

DROP TABLE book_pages;
ALTER TABLE book_pages_new RENAME TO book_pages;

CREATE VIRTUAL TABLE book_pages_fts USING fts5(
    text,
    content = 'book_pages',
    content_rowid = 'seq',
    tokenize = 'trigram'
);

CREATE TRIGGER book_pages_fts_insert AFTER INSERT ON book_pages BEGIN
    INSERT INTO book_pages_fts (rowid, text) VALUES (new.seq, new.text);
END;

CREATE TRIGGER book_pages_fts_delete AFTER DELETE ON book_pages BEGIN
    INSERT INTO book_pages_fts (book_pages_fts, rowid, text) VALUES ('delete', old.seq, old.text);
END;

CREATE TRIGGER book_pages_fts_update AFTER UPDATE OF text ON book_pages BEGIN
    INSERT INTO book_pages_fts (book_pages_fts, rowid, text) VALUES ('delete', old.seq, old.text);
    INSERT INTO book_pages_fts (rowid, text) VALUES (new.seq, new.text);
END;

INSERT INTO book_pages_fts (book_pages_fts) VALUES ('rebuild');
