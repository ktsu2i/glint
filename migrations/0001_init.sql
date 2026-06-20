CREATE TABLE IF NOT EXISTS books (
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
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_reading_states (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);
