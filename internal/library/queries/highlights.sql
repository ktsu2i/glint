-- name: InsertHighlight :one
INSERT INTO book_highlights (book_id, page_number, color, text, rects, created_at)
VALUES (@book_id, @page_number, @color, @text, @rects, @created_at)
RETURNING id;

-- name: ListHighlights :many
SELECT id, page_number, color, text, rects, created_at
  FROM book_highlights
 WHERE book_id = @book_id
 ORDER BY page_number ASC, id ASC;

-- name: DeleteHighlight :exec
DELETE FROM book_highlights
 WHERE book_id = @book_id AND id = @id;
