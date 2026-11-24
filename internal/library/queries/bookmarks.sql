-- name: InsertBookmark :exec
INSERT INTO book_bookmarks (book_id, page_number, created_at)
VALUES (@book_id, @page_number, @created_at)
ON CONFLICT DO NOTHING;

-- name: GetBookmark :one
SELECT page_number, created_at
  FROM book_bookmarks
 WHERE book_id = @book_id AND page_number = @page_number;

-- name: ListBookmarks :many
SELECT page_number, created_at
  FROM book_bookmarks
 WHERE book_id = @book_id
 ORDER BY page_number ASC;

-- name: DeleteBookmark :exec
DELETE FROM book_bookmarks
 WHERE book_id = @book_id AND page_number = @page_number;
