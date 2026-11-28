-- +goose Up
CREATE TABLE books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    source_path TEXT NOT NULL,
    file_hash TEXT NOT NULL UNIQUE,
    size_bytes INTEGER NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0,
    cover_thumbnail_path TEXT NOT NULL DEFAULT '',
    cover_thumbnail_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (cover_thumbnail_status IN ('pending', 'ready', 'failed')),
    imported_at TEXT NOT NULL,
    last_opened_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT 'pdf',
    source_mod_time TEXT NOT NULL DEFAULT ''
);

CREATE TABLE book_reading_states (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    -- The exact place an EPUB was left, as an EPUB CFI inside the section kept in
    -- page_number. PDFs keep an empty CFI.
    cfi TEXT NOT NULL DEFAULT '',
    -- Which side a PDF is bound on, so a spread reads left to right or right to left.
    binding_direction TEXT NOT NULL DEFAULT 'ltr'
        CHECK (binding_direction IN ('ltr', 'rtl'))
);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Searchable text of a book: pages for PDF, sections for EPUB.
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

CREATE VIRTUAL TABLE book_segments_fts USING fts5(
    text,
    content = 'book_segments',
    content_rowid = 'id',
    tokenize = 'trigram'
);

-- +goose StatementBegin
CREATE TRIGGER book_segments_fts_insert AFTER INSERT ON book_segments BEGIN
    INSERT INTO book_segments_fts (rowid, text) VALUES (new.id, new.text);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER book_segments_fts_delete AFTER DELETE ON book_segments BEGIN
    INSERT INTO book_segments_fts (book_segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER book_segments_fts_update AFTER UPDATE OF text ON book_segments BEGIN
    INSERT INTO book_segments_fts (book_segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO book_segments_fts (rowid, text) VALUES (new.id, new.text);
END;
-- +goose StatementEnd

-- A PDF highlight is placed by rectangles on a page; an EPUB highlight by an
-- EPUB CFI, because EPUB pages reflow. Exactly one of them is set.
CREATE TABLE book_highlights (
    id INTEGER PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    color TEXT NOT NULL CHECK (color IN ('yellow', 'green', 'pink', 'purple')),
    text TEXT NOT NULL CHECK (text <> ''),
    -- JSON array of {x, y, width, height}, as fractions of the page size.
    rects TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cfi TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_book_highlights_book_page
    ON book_highlights(book_id, page_number, id);

-- A PDF bookmark is a page. An EPUB bookmark is placed by an EPUB CFI, and a
-- section can hold several bookmarks. progress is where the bookmark sits in
-- the book, from 0 to 1, for showing it on the slider; PDF bookmarks keep 0.
CREATE TABLE book_bookmarks (
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    cfi TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    created_at TEXT NOT NULL,
    PRIMARY KEY (book_id, page_number, cfi)
);

-- +goose Down
DROP TABLE book_bookmarks;
DROP TABLE book_highlights;
DROP TABLE book_segments_fts;
DROP TABLE book_segments;
DROP TABLE app_settings;
DROP TABLE book_reading_states;
DROP TABLE books;
