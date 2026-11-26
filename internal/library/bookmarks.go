package library

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/kaito/glint/internal/library/librarydb"
)

var ErrInvalidBookmark = errors.New("invalid bookmark")

// BookBookmark marks a PDF page, or a place in an EPUB by CFI. For an EPUB,
// PageNumber is the section, counted from 1, and Progress is where the place
// sits in the book, from 0 to 1. A PDF bookmark has an empty CFI and Progress 0.
type BookBookmark struct {
	PageNumber int
	CFI        string
	Progress   float64
	CreatedAt  string
}

type NewBookmark struct {
	PageNumber int
	PageCount  int
	CFI        string
	Progress   float64
}

func (store *Store) SaveBookmark(ctx context.Context, bookID string, input NewBookmark, now time.Time) (BookBookmark, error) {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" || !validBookmark(input) {
		return BookBookmark{}, ErrInvalidBookmark
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	err := store.inTx(ctx, func(queries *librarydb.Queries) error {
		affected, err := queries.UpdateBookPageCount(ctx, librarydb.UpdateBookPageCountParams{
			PageCount: int64(input.PageCount),
			UpdatedAt: timestamp,
			ID:        bookID,
		})
		if err := requireChanged(affected, err, "update book page count"); err != nil {
			return err
		}
		return queries.InsertBookmark(ctx, librarydb.InsertBookmarkParams{
			BookID:     bookID,
			PageNumber: int64(input.PageNumber),
			Cfi:        input.CFI,
			Progress:   input.Progress,
			CreatedAt:  timestamp,
		})
	})
	if err != nil {
		return BookBookmark{}, fmt.Errorf("save bookmark: %w", err)
	}
	saved, err := store.queries.GetBookmark(ctx, librarydb.GetBookmarkParams{
		BookID:     bookID,
		PageNumber: int64(input.PageNumber),
		Cfi:        input.CFI,
	})
	if err != nil {
		return BookBookmark{}, fmt.Errorf("read saved bookmark: %w", err)
	}
	return bookmarkFromRow(librarydb.ListBookmarksRow(saved)), nil
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
		bookmarks[i] = bookmarkFromRow(row)
	}
	return bookmarks, nil
}

// DeleteBookmark removes the bookmark on a PDF page, or at a CFI in an EPUB
// section. A PDF bookmark is removed with an empty CFI.
func (store *Store) DeleteBookmark(ctx context.Context, bookID string, pageNumber int, cfi string) error {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" || pageNumber < 1 || (cfi != "" && !validCFI(cfi)) {
		return ErrInvalidBookmark
	}
	if _, err := store.Get(ctx, bookID); err != nil {
		return err
	}
	if err := store.queries.DeleteBookmark(ctx, librarydb.DeleteBookmarkParams{
		BookID:     bookID,
		PageNumber: int64(pageNumber),
		Cfi:        cfi,
	}); err != nil {
		return fmt.Errorf("delete bookmark: %w", err)
	}
	return nil
}

func bookmarkFromRow(row librarydb.ListBookmarksRow) BookBookmark {
	return BookBookmark{
		PageNumber: int(row.PageNumber),
		CFI:        row.Cfi,
		Progress:   row.Progress,
		CreatedAt:  row.CreatedAt,
	}
}

func validBookmark(input NewBookmark) bool {
	if input.PageCount < 1 || input.PageNumber < 1 || input.PageNumber > input.PageCount {
		return false
	}
	if math.IsNaN(input.Progress) || input.Progress < 0 || input.Progress > 1 {
		return false
	}
	if input.CFI == "" {
		// A PDF bookmark marks the whole page.
		return input.Progress == 0
	}
	return validCFI(input.CFI)
}
