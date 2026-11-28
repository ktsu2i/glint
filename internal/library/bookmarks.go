package library

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/ktsu2i/glint/internal/library/librarydb"
)

var ErrInvalidBookmark = errors.New("invalid bookmark")

type BookmarkLocation interface {
	bookmarkLocation()
}

type PDFBookmarkLocation struct {
	Page int
}

type EPUBBookmarkLocation struct {
	Section  int
	CFI      string
	Progress float64
}

func (PDFBookmarkLocation) bookmarkLocation()  {}
func (EPUBBookmarkLocation) bookmarkLocation() {}

type BookBookmark struct {
	Location  BookmarkLocation
	CreatedAt string
}

type NewBookmark struct {
	Location  BookmarkLocation
	PageCount int
}

type bookmarkKey struct {
	pageNumber int
	cfi        string
	progress   float64
}

func keyOfBookmark(location BookmarkLocation) (bookmarkKey, bool) {
	switch location := location.(type) {
	case PDFBookmarkLocation:
		return bookmarkKey{pageNumber: location.Page}, true
	case EPUBBookmarkLocation:
		if !validCFI(location.CFI) || math.IsNaN(location.Progress) ||
			location.Progress < 0 || location.Progress > 1 {
			return bookmarkKey{}, false
		}
		return bookmarkKey{pageNumber: location.Section, cfi: location.CFI, progress: location.Progress}, true
	default:
		return bookmarkKey{}, false
	}
}

func (store *Store) SaveBookmark(ctx context.Context, bookID string, input NewBookmark, now time.Time) (BookBookmark, error) {
	bookID = strings.TrimSpace(bookID)
	key, ok := keyOfBookmark(input.Location)
	if bookID == "" || !ok || input.PageCount < 1 || key.pageNumber < 1 || key.pageNumber > input.PageCount {
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
			PageNumber: int64(key.pageNumber),
			Cfi:        key.cfi,
			Progress:   key.progress,
			CreatedAt:  timestamp,
		})
	})
	if err != nil {
		return BookBookmark{}, fmt.Errorf("save bookmark: %w", err)
	}
	saved, err := store.queries.GetBookmark(ctx, librarydb.GetBookmarkParams{
		BookID:     bookID,
		PageNumber: int64(key.pageNumber),
		Cfi:        key.cfi,
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

func (store *Store) DeleteBookmark(ctx context.Context, bookID string, location BookmarkLocation) error {
	bookID = strings.TrimSpace(bookID)
	key, ok := keyOfBookmark(location)
	if bookID == "" || !ok || key.pageNumber < 1 {
		return ErrInvalidBookmark
	}
	if _, err := store.Get(ctx, bookID); err != nil {
		return err
	}
	if err := store.queries.DeleteBookmark(ctx, librarydb.DeleteBookmarkParams{
		BookID:     bookID,
		PageNumber: int64(key.pageNumber),
		Cfi:        key.cfi,
	}); err != nil {
		return fmt.Errorf("delete bookmark: %w", err)
	}
	return nil
}

func bookmarkFromRow(row librarydb.ListBookmarksRow) BookBookmark {
	var location BookmarkLocation = PDFBookmarkLocation{Page: int(row.PageNumber)}
	if row.Cfi != "" {
		location = EPUBBookmarkLocation{Section: int(row.PageNumber), CFI: row.Cfi, Progress: row.Progress}
	}
	return BookBookmark{Location: location, CreatedAt: row.CreatedAt}
}
