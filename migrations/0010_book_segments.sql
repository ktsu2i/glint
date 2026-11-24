CREATE TABLE book_segments (
    id INTEGER PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal > 0),
    kind TEXT NOT NULL CHECK (kind IN ('page', 'section')),
    location TEXT NOT NULL CHECK (location <> ''),
    heading_path TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE (book_id, ordinal)
);

INSERT INTO book_segments (book_id, ordinal, kind, location, text, updated_at)
SELECT p.book_id,
       p.page_number,
       CASE WHEN b.format = 'epub' THEN 'section' ELSE 'page' END,
       CASE WHEN b.format = 'epub' THEN 'spine:' || (p.page_number - 1) ELSE 'page:' || p.page_number END,
       p.text,
       p.updated_at
  FROM book_pages p
  JOIN books b ON b.id = p.book_id
 ORDER BY p.book_id, p.page_number;

DROP TRIGGER book_pages_fts_insert;
DROP TRIGGER book_pages_fts_delete;
DROP TRIGGER book_pages_fts_update;
DROP TABLE book_pages_fts;
DROP TABLE book_pages;

CREATE VIRTUAL TABLE book_segments_fts USING fts5(
    text,
    content = 'book_segments',
    content_rowid = 'id',
    tokenize = 'trigram'
);

CREATE TRIGGER book_segments_fts_insert AFTER INSERT ON book_segments BEGIN
    INSERT INTO book_segments_fts (rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER book_segments_fts_delete AFTER DELETE ON book_segments BEGIN
    INSERT INTO book_segments_fts (book_segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER book_segments_fts_update AFTER UPDATE OF text ON book_segments BEGIN
    INSERT INTO book_segments_fts (book_segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO book_segments_fts (rowid, text) VALUES (new.id, new.text);
END;

INSERT INTO book_segments_fts (book_segments_fts) VALUES ('rebuild');
