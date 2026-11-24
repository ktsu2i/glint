package library

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	gormsqlite "github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"

	"github.com/kaito/glint/internal/sqlite"
	"github.com/kaito/glint/migrations"
)

type Store struct {
	path string
	db   *gorm.DB
}

const (
	BookFormatPDF  = "pdf"
	BookFormatEPUB = "epub"
)

type Book struct {
	ID                   string
	Title                string
	DisplayName          string
	FileName             string
	SourcePath           string
	SourceModTime        string
	FileHash             string
	Format               string
	SizeBytes            int64
	PageCount            int
	CoverThumbnailPath   string
	CoverThumbnailStatus string
	ImportedAt           string
	LastOpenedAt         string
	LastPage             int
}

func (b Book) Display() string {
	if b.DisplayName != "" {
		return b.DisplayName
	}
	return b.Title
}

type bookRecord struct {
	ID                   string `gorm:"column:id;primaryKey"`
	Title                string `gorm:"column:title"`
	DisplayName          string `gorm:"column:display_name"`
	FileName             string `gorm:"column:file_name"`
	SourcePath           string `gorm:"column:source_path"`
	SourceModTime        string `gorm:"column:source_mod_time"`
	FileHash             string `gorm:"column:file_hash"`
	Format               string `gorm:"column:format"`
	SizeBytes            int64  `gorm:"column:size_bytes"`
	PageCount            int    `gorm:"column:page_count"`
	CoverThumbnailPath   string `gorm:"column:cover_thumbnail_path"`
	CoverThumbnailStatus string `gorm:"column:cover_thumbnail_status"`
	ImportedAt           string `gorm:"column:imported_at"`
	LastOpenedAt         string `gorm:"column:last_opened_at"`
	UpdatedAt            string `gorm:"column:updated_at"`
}

func (bookRecord) TableName() string { return "books" }

type readingStateRecord struct {
	BookID     string `gorm:"column:book_id;primaryKey"`
	PageNumber int    `gorm:"column:page_number"`
	UpdatedAt  string `gorm:"column:updated_at"`
}

func (readingStateRecord) TableName() string { return "book_reading_states" }

type appSettingRecord struct {
	Key       string `gorm:"column:key;primaryKey"`
	Value     string `gorm:"column:value"`
	UpdatedAt string `gorm:"column:updated_at"`
}

func (appSettingRecord) TableName() string { return "app_settings" }

func New(path string) *Store {
	return &Store{path: path}
}

func Open(path string) (*Store, error) {
	store := New(path)
	if err := store.Connect(); err != nil {
		return nil, err
	}
	return store, nil
}

func (store *Store) Connect() error {
	if store.db != nil {
		return nil
	}
	if err := ensureParentDirectory(store.path); err != nil {
		return err
	}
	db, err := gorm.Open(gormsqlite.Open(store.path), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return fmt.Errorf("open library database: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("open library database: %w", err)
	}
	sqlDB.SetMaxOpenConns(1)

	store.db = db
	if err := store.migrate(context.Background()); err != nil {
		store.db = nil
		_ = sqlDB.Close()
		return err
	}
	return nil
}

func ensureParentDirectory(path string) error {
	if path == ":memory:" || strings.HasPrefix(path, "file:") {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create library database directory: %w", err)
	}
	return nil
}

func (store *Store) migrate(ctx context.Context) error {
	db := store.db.WithContext(ctx)
	for _, statement := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
		"PRAGMA journal_mode = WAL",
	} {
		if err := db.Exec(statement).Error; err != nil {
			return fmt.Errorf("apply library pragma: %w", err)
		}
	}

	sqlDB, err := store.db.DB()
	if err != nil {
		return fmt.Errorf("access library database handle: %w", err)
	}
	migrator := &sqlite.Migrator{DB: sqlDB, FS: migrations.FS}
	if err := migrator.Up(ctx); err != nil {
		return fmt.Errorf("apply library migrations: %w", err)
	}
	return nil
}

func (store *Store) Close() error {
	if store == nil || store.db == nil {
		return nil
	}
	sqlDB, err := store.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func (store *Store) Import(ctx context.Context, id, sourcePath, fileHash, format string, size int64, now time.Time) (Book, error) {
	if id == "" || sourcePath == "" || fileHash == "" {
		return Book{}, errors.New("book id, source path, and file hash are required")
	}
	if format != BookFormatPDF && format != BookFormatEPUB {
		return Book{}, fmt.Errorf("unsupported book format %q", format)
	}
	fileName := filepath.Base(sourcePath)
	title := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	timestamp := now.UTC().Format(time.RFC3339Nano)

	record := bookRecord{
		ID:                   id,
		Title:                title,
		FileName:             fileName,
		SourcePath:           sourcePath,
		FileHash:             fileHash,
		Format:               format,
		SizeBytes:            size,
		CoverThumbnailStatus: "pending",
		ImportedAt:           timestamp,
		UpdatedAt:            timestamp,
	}
	err := store.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "file_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"title", "source_path", "file_name", "size_bytes", "updated_at",
		}),
	}).Create(&record).Error
	if err != nil {
		return Book{}, fmt.Errorf("save imported book: %w", err)
	}
	return store.ByHash(ctx, fileHash)
}

const selectBookColumns = `b.id, b.title, b.display_name, b.file_name, b.source_path, b.source_mod_time, b.file_hash,
       b.format, b.size_bytes, b.page_count, b.cover_thumbnail_path,
       b.cover_thumbnail_status, b.imported_at, b.last_opened_at,
       COALESCE(r.page_number, 1) AS last_page`

func (store *Store) List(ctx context.Context) ([]Book, error) {
	var books []Book
	err := store.db.WithContext(ctx).Raw(`
        SELECT ` + selectBookColumns + `
          FROM books b
          LEFT JOIN book_reading_states r ON r.book_id = b.id
         ORDER BY CASE WHEN b.last_opened_at = '' THEN 1 ELSE 0 END,
                  b.last_opened_at DESC,
                  b.imported_at DESC
    `).Scan(&books).Error
	if err != nil {
		return nil, fmt.Errorf("list books: %w", err)
	}
	return books, nil
}

func (store *Store) Get(ctx context.Context, id string) (Book, error) {
	return store.queryBook(ctx, "b.id = ?", id)
}

func (store *Store) ByHash(ctx context.Context, hash string) (Book, error) {
	return store.queryBook(ctx, "b.file_hash = ?", hash)
}

func (store *Store) queryBook(ctx context.Context, where string, value any) (Book, error) {
	var book Book
	result := store.db.WithContext(ctx).Raw(`
        SELECT `+selectBookColumns+`
          FROM books b
          LEFT JOIN book_reading_states r ON r.book_id = b.id
         WHERE `+where, value).Scan(&book)
	if result.Error != nil {
		return Book{}, fmt.Errorf("get book: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return Book{}, ErrBookNotFound
	}
	return book, nil
}

func (store *Store) MarkOpened(ctx context.Context, id string, now time.Time) error {
	timestamp := now.UTC().Format(time.RFC3339Nano)
	result := store.db.WithContext(ctx).Model(&bookRecord{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"last_opened_at": timestamp,
			"updated_at":     timestamp,
		})
	return requireChanged(result, "mark book opened")
}

func (store *Store) SaveReadingPosition(ctx context.Context, id string, pageNumber, pageCount int, now time.Time) error {
	if pageNumber < 1 || pageCount < 1 || pageNumber > pageCount {
		return errors.New("reading position is outside the document")
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	return store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&bookRecord{}).
			Where("id = ?", id).
			Updates(map[string]any{
				"page_count": pageCount,
				"updated_at": timestamp,
			})
		if err := requireChanged(result, "update book page count"); err != nil {
			return err
		}
		state := readingStateRecord{
			BookID:     id,
			PageNumber: pageNumber,
			UpdatedAt:  timestamp,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "book_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"page_number", "updated_at"}),
		}).Create(&state).Error; err != nil {
			return fmt.Errorf("save reading position: %w", err)
		}
		return nil
	})
}

func (store *Store) SaveCover(ctx context.Context, id, path string, now time.Time) error {
	result := store.db.WithContext(ctx).Model(&bookRecord{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"cover_thumbnail_path":   path,
			"cover_thumbnail_status": "ready",
			"updated_at":             now.UTC().Format(time.RFC3339Nano),
		})
	return requireChanged(result, "save book cover")
}

func (store *Store) MarkCoverFailed(ctx context.Context, id string, now time.Time) error {
	result := store.db.WithContext(ctx).Model(&bookRecord{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"cover_thumbnail_path":   "",
			"cover_thumbnail_status": "failed",
			"updated_at":             now.UTC().Format(time.RFC3339Nano),
		})
	return requireChanged(result, "mark book cover failed")
}

func (store *Store) ResetCover(ctx context.Context, id string, now time.Time) error {
	result := store.db.WithContext(ctx).Model(&bookRecord{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"cover_thumbnail_path":   "",
			"cover_thumbnail_status": "pending",
			"updated_at":             now.UTC().Format(time.RFC3339Nano),
		})
	return requireChanged(result, "reset book cover")
}

const MaxDisplayNameLength = 200

var ErrInvalidDisplayName = errors.New("invalid book display name")

func (store *Store) Rename(ctx context.Context, id, name string, now time.Time) (Book, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return Book{}, ErrInvalidDisplayName
	}
	if len([]rune(trimmed)) > MaxDisplayNameLength {
		return Book{}, ErrInvalidDisplayName
	}
	result := store.db.WithContext(ctx).Model(&bookRecord{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"display_name": trimmed,
			"updated_at":   now.UTC().Format(time.RFC3339Nano),
		})
	if err := requireChanged(result, "rename book"); err != nil {
		return Book{}, err
	}
	return store.Get(ctx, id)
}

func (store *Store) Remove(ctx context.Context, id string) error {
	result := store.db.WithContext(ctx).Where("id = ?", id).Delete(&bookRecord{})
	return requireChanged(result, "remove book")
}

func (store *Store) Relink(ctx context.Context, id, sourcePath, fileHash string, size int64, now time.Time) (Book, error) {
	book, err := store.Get(ctx, id)
	if err != nil {
		return Book{}, err
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	coverPath := book.CoverThumbnailPath
	coverStatus := book.CoverThumbnailStatus
	if fileHash != book.FileHash {
		coverPath = ""
		coverStatus = "pending"
	}
	fileName := filepath.Base(sourcePath)
	title := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	pageCount := book.PageCount
	if fileHash != book.FileHash {
		pageCount = 0
	}
	err = store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if fileHash != book.FileHash {
			if err := tx.Where("book_id = ?", id).Delete(&bookPageRecord{}).Error; err != nil {
				return fmt.Errorf("clear stale book pages: %w", err)
			}
		}
		return tx.Model(&bookRecord{}).
			Where("id = ?", id).
			Updates(map[string]any{
				"title":                  title,
				"file_name":              fileName,
				"source_path":            sourcePath,
				"source_mod_time":        "",
				"file_hash":              fileHash,
				"size_bytes":             size,
				"page_count":             pageCount,
				"cover_thumbnail_path":   coverPath,
				"cover_thumbnail_status": coverStatus,
				"updated_at":             timestamp,
			}).Error
	})
	if err != nil {
		return Book{}, fmt.Errorf("relink book: %w", err)
	}
	return store.Get(ctx, id)
}

func (store *Store) RecordSourceStat(ctx context.Context, id string, size int64, modTime, now time.Time) error {
	result := store.db.WithContext(ctx).Model(&bookRecord{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"size_bytes":      size,
			"source_mod_time": FormatSourceModTime(modTime),
			"updated_at":      now.UTC().Format(time.RFC3339Nano),
		})
	return requireChanged(result, "record book source stat")
}

func FormatSourceModTime(modTime time.Time) string {
	return modTime.UTC().Format(time.RFC3339Nano)
}

func (store *Store) Setting(ctx context.Context, key string) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", errors.New("setting key is required")
	}
	var record appSettingRecord
	result := store.db.WithContext(ctx).Where("key = ?", key).Take(&record)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if result.Error != nil {
		return "", fmt.Errorf("read app setting: %w", result.Error)
	}
	return record.Value, nil
}

func (store *Store) SaveSetting(ctx context.Context, key, value string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return errors.New("setting key is required")
	}
	record := appSettingRecord{
		Key:       key,
		Value:     value,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := store.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&record).Error; err != nil {
		return fmt.Errorf("save app setting: %w", err)
	}
	return nil
}

var ErrBookNotFound = errors.New("book not found")

func requireChanged(result *gorm.DB, operation string) error {
	if result.Error != nil {
		return fmt.Errorf("%s: %w", operation, result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrBookNotFound
	}
	return nil
}
