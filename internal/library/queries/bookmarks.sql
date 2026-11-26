-- name: InsertBookmark :exec
INSERT INTO book_bookmarks (book_id, page_number, cfi, progress, created_at)
VALUES (@book_id, @page_number, @cfi, @progress, @created_at)
ON CONFLICT DO NOTHING;

-- name: GetBookmark :one
SELECT page_number, cfi, progress, created_at
  FROM book_bookmarks
 WHERE book_id = @book_id AND page_number = @page_number AND cfi = @cfi;

-- name: ListBookmarks :many
SELECT page_number, cfi, progress, created_at
  FROM book_bookmarks
 WHERE book_id = @book_id
 ORDER BY page_number ASC, progress ASC, created_at ASC;

-- name: DeleteBookmark :exec
DELETE FROM book_bookmarks
 WHERE book_id = @book_id AND page_number = @page_number AND cfi = @cfi;
