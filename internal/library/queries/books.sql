-- name: ImportBook :exec
INSERT INTO books (
    id, title, file_name, source_path, file_hash, format, size_bytes,
    cover_thumbnail_status, imported_at, updated_at
) VALUES (
    @id, @title, @file_name, @source_path, @file_hash, @format, @size_bytes,
    'pending', @imported_at, @updated_at
)
ON CONFLICT (file_hash) DO UPDATE SET
    title = excluded.title,
    source_path = excluded.source_path,
    file_name = excluded.file_name,
    size_bytes = excluded.size_bytes,
    updated_at = excluded.updated_at;

-- name: ListBooks :many
SELECT sqlc.embed(b), CAST(COALESCE(r.page_number, 1) AS INTEGER) AS last_page
  FROM books b
  LEFT JOIN book_reading_states r ON r.book_id = b.id
 ORDER BY CASE WHEN b.last_opened_at = '' THEN 1 ELSE 0 END,
          b.last_opened_at DESC,
          b.imported_at DESC;

-- name: GetBook :one
SELECT sqlc.embed(b), CAST(COALESCE(r.page_number, 1) AS INTEGER) AS last_page
  FROM books b
  LEFT JOIN book_reading_states r ON r.book_id = b.id
 WHERE b.id = @id;

-- name: GetBookByHash :one
SELECT sqlc.embed(b), CAST(COALESCE(r.page_number, 1) AS INTEGER) AS last_page
  FROM books b
  LEFT JOIN book_reading_states r ON r.book_id = b.id
 WHERE b.file_hash = @file_hash;

-- name: MarkBookOpened :execrows
UPDATE books
   SET last_opened_at = @opened_at,
       updated_at = @opened_at
 WHERE id = @id;

-- name: UpdateBookPageCount :execrows
UPDATE books
   SET page_count = @page_count,
       updated_at = @updated_at
 WHERE id = @id;

-- name: UpsertReadingState :exec
INSERT INTO book_reading_states (book_id, page_number, updated_at)
VALUES (@book_id, @page_number, @updated_at)
ON CONFLICT (book_id) DO UPDATE SET
    page_number = excluded.page_number,
    updated_at = excluded.updated_at;

-- name: SetBookCover :execrows
UPDATE books
   SET cover_thumbnail_path = @cover_thumbnail_path,
       cover_thumbnail_status = @cover_thumbnail_status,
       updated_at = @updated_at
 WHERE id = @id;

-- name: RenameBook :execrows
UPDATE books
   SET display_name = @display_name,
       updated_at = @updated_at
 WHERE id = @id;

-- name: DeleteBook :execrows
DELETE FROM books WHERE id = @id;

-- name: RelinkBook :exec
UPDATE books
   SET title = @title,
       file_name = @file_name,
       source_path = @source_path,
       source_mod_time = '',
       file_hash = @file_hash,
       size_bytes = @size_bytes,
       page_count = @page_count,
       cover_thumbnail_path = @cover_thumbnail_path,
       cover_thumbnail_status = @cover_thumbnail_status,
       updated_at = @updated_at
 WHERE id = @id;

-- name: RecordBookSourceStat :execrows
UPDATE books
   SET size_bytes = @size_bytes,
       source_mod_time = @source_mod_time,
       updated_at = @updated_at
 WHERE id = @id;

-- name: GetAppSetting :one
SELECT value FROM app_settings WHERE key = @key;

-- name: UpsertAppSetting :exec
INSERT INTO app_settings (key, value, updated_at)
VALUES (@key, @value, @updated_at)
ON CONFLICT (key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at;
