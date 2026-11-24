-- name: UpsertBookSegment :exec
INSERT INTO book_segments (book_id, ordinal, kind, location, heading_path, text, updated_at)
VALUES (@book_id, @ordinal, @kind, @location, @heading_path, @text, @updated_at)
ON CONFLICT (book_id, ordinal) DO UPDATE SET
    kind = excluded.kind,
    location = excluded.location,
    heading_path = excluded.heading_path,
    text = excluded.text,
    updated_at = excluded.updated_at;

-- name: DeleteBookSegments :exec
DELETE FROM book_segments WHERE book_id = @book_id;

-- name: CountBookSegments :one
SELECT COUNT(*) FROM book_segments WHERE book_id = @book_id;

-- name: FirstMissingOrdinal :one
-- sqlc cannot resolve unqualified columns in nested subqueries, so every table gets an alias.
SELECT CAST(CASE
         WHEN NOT EXISTS (
             SELECT 1 FROM book_segments f
              WHERE f.book_id = @book_id AND f.ordinal = 1) THEN 1
         ELSE (SELECT MIN(s.ordinal) + 1
                 FROM book_segments s
                WHERE s.book_id = @book_id
                  AND NOT EXISTS (
                      SELECT 1 FROM book_segments n
                       WHERE n.book_id = s.book_id AND n.ordinal = s.ordinal + 1))
       END AS INTEGER) AS next_ordinal;
