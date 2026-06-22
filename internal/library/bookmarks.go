package library

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrInvalidBookmark = errors.New("invalid bookmark")

type BookBookmark struct {
	PageNumber int
	CreatedAt  string
}

type bookBookmarkRecord struct {
	BookID     string `gorm:"column:book_id;primaryKey"`
	PageNumber int    `gorm:"column:page_number;primaryKey"`
	CreatedAt  string `gorm:"column:created_at"`
}

func (bookBookmarkRecord) TableName() string { return "book_bookmarks" }

// SaveBookmark persists a page marker once per book and page. pageCount comes
// from the loaded PDF so a bookmark can be saved before reading-position
// persistence has populated the book metadata.
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
	record := bookBookmarkRecord{
		BookID:     bookID,
		PageNumber: pageNumber,
		CreatedAt:  timestamp,
	}
	err := store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&bookRecord{}).
			Where("id = ?", bookID).
			Updates(map[string]any{"page_count": pageCount, "updated_at": timestamp})
		if err := requireChanged(result, "update book page count"); err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&record).Error
	})
	if err != nil {
		return BookBookmark{}, fmt.Errorf("save bookmark: %w", err)
	}
	var saved BookBookmark
	if err := store.db.WithContext(ctx).Model(&bookBookmarkRecord{}).
		Select("page_number, created_at").
		Where("book_id = ? AND page_number = ?", bookID, pageNumber).
		Take(&saved).Error; err != nil {
		return BookBookmark{}, fmt.Errorf("read saved bookmark: %w", err)
	}
	return saved, nil
}

func (store *Store) ListBookmarks(ctx context.Context, bookID string) ([]BookBookmark, error) {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" {
		return nil, ErrInvalidBookmark
	}
	if _, err := store.Get(ctx, bookID); err != nil {
		return nil, err
	}
	var bookmarks []BookBookmark
	if err := store.db.WithContext(ctx).Model(&bookBookmarkRecord{}).
		Select("page_number, created_at").
		Where("book_id = ?", bookID).
		Order("page_number ASC").
		Scan(&bookmarks).Error; err != nil {
		return nil, fmt.Errorf("list bookmarks: %w", err)
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
	if err := store.db.WithContext(ctx).
		Where("book_id = ? AND page_number = ?", bookID, pageNumber).
		Delete(&bookBookmarkRecord{}).Error; err != nil {
		return fmt.Errorf("delete bookmark: %w", err)
	}
	return nil
}
