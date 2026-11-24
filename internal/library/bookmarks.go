package library

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/kaito/glint/internal/library/librarydb"
)

var ErrInvalidBookmark = errors.New("invalid bookmark")

type BookBookmark struct {
	PageNumber int
	CreatedAt  string
}

func (store *Store) SaveBookmark(
	ctx context.Context,
	bookID string,
	pageNumber, pageCount int,
	now time.Time,
) (BookBookmark, error) {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" || pageCount < 1 || pageNumber < 1 || pageNumber > pageCount {
		return BookBookmark{}, ErrInvalidBookmark
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	err := store.inTx(ctx, func(queries *librarydb.Queries) error {
		affected, err := queries.UpdateBookPageCount(ctx, librarydb.UpdateBookPageCountParams{
			PageCount: int64(pageCount),
			UpdatedAt: timestamp,
			ID:        bookID,
		})
		if err := requireChanged(affected, err, "update book page count"); err != nil {
			return err
		}
		return queries.InsertBookmark(ctx, librarydb.InsertBookmarkParams{
			BookID:     bookID,
			PageNumber: int64(pageNumber),
			CreatedAt:  timestamp,
		})
	})
	if err != nil {
		return BookBookmark{}, fmt.Errorf("save bookmark: %w", err)
	}
	saved, err := store.queries.GetBookmark(ctx, librarydb.GetBookmarkParams{
		BookID:     bookID,
		PageNumber: int64(pageNumber),
	})
	if err != nil {
		return BookBookmark{}, fmt.Errorf("read saved bookmark: %w", err)
	}
	return BookBookmark{PageNumber: int(saved.PageNumber), CreatedAt: saved.CreatedAt}, nil
}

func (store *Store) ListBookmarks(ctx context.Context, bookID string) ([]BookBookmark, error) {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" {
		return nil, ErrInvalidBookmark
	}
	if _, err := store.Get(ctx, bookID); err != nil {
		return nil, err
	}
	rows, err := store.queries.ListBookmarks(ctx, bookID)
	if err != nil {
		return nil, fmt.Errorf("list bookmarks: %w", err)
	}
	bookmarks := make([]BookBookmark, len(rows))
	for i, row := range rows {
		bookmarks[i] = BookBookmark{PageNumber: int(row.PageNumber), CreatedAt: row.CreatedAt}
	}
	return bookmarks, nil
}

func (store *Store) DeleteBookmark(ctx context.Context, bookID string, pageNumber int) error {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" || pageNumber < 1 {
		return ErrInvalidBookmark
	}
	if _, err := store.Get(ctx, bookID); err != nil {
		return err
	}
	if err := store.queries.DeleteBookmark(ctx, librarydb.DeleteBookmarkParams{
		BookID:     bookID,
		PageNumber: int64(pageNumber),
	}); err != nil {
		return fmt.Errorf("delete bookmark: %w", err)
	}
	return nil
}
