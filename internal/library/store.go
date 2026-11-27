package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/glebarez/go-sqlite" // registers the pure Go "sqlite" database/sql driver

	"github.com/kaito/glint/internal/library/librarydb"
	"github.com/kaito/glint/internal/sqlite"
	"github.com/kaito/glint/migrations"
)

type Store struct {
	path    string
	db      *sql.DB
	queries *librarydb.Queries
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
	// LastCFI is the place in the LastPage section where an EPUB was left.
	// It is empty for a PDF.
	LastCFI          string
	BindingDirection string
}

// A PDF spread reads left to right, or right to left for a book bound on the right.
const (
	BindingLeftToRight = "ltr"
	BindingRightToLeft = "rtl"
)

var (
	ErrInvalidReadingPosition  = errors.New("reading position is outside the document")
	ErrInvalidBindingDirection = errors.New("binding direction must be ltr or rtl")
)

type readingState struct {
	lastPage         int64
	lastCFI          string
	bindingDirection string
}

func (b Book) Display() string {
	if b.DisplayName != "" {
		return b.DisplayName
	}
	return b.Title
}

func bookFromRow(record librarydb.Book, state readingState) Book {
	return Book{
		ID:                   record.ID,
		Title:                record.Title,
		DisplayName:          record.DisplayName,
		FileName:             record.FileName,
		SourcePath:           record.SourcePath,
		SourceModTime:        record.SourceModTime,
		FileHash:             record.FileHash,
		Format:               record.Format,
		SizeBytes:            record.SizeBytes,
		PageCount:            int(record.PageCount),
		CoverThumbnailPath:   record.CoverThumbnailPath,
		CoverThumbnailStatus: record.CoverThumbnailStatus,
		ImportedAt:           record.ImportedAt,
		LastOpenedAt:         record.LastOpenedAt,
		LastPage:             int(state.lastPage),
		LastCFI:              state.lastCFI,
		BindingDirection:     state.bindingDirection,
	}
}

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
	db, err := sql.Open("sqlite", store.path)
	if err != nil {
		return fmt.Errorf("open library database: %w", err)
	}
	db.SetMaxOpenConns(1)

	if err := migrate(context.Background(), db); err != nil {
		_ = db.Close()
		return err
	}
	store.db = db
	store.queries = librarydb.New(db)
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

func migrate(ctx context.Context, db *sql.DB) error {
	for _, statement := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
		"PRAGMA journal_mode = WAL",
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("apply library pragma: %w", err)
		}
	}

	migrator := &sqlite.Migrator{DB: db, FS: migrations.FS}
	if err := migrator.Up(ctx); err != nil {
		return fmt.Errorf("apply library migrations: %w", err)
	}
	return nil
}

func (store *Store) Close() error {
	if store == nil || store.db == nil {
		return nil
	}
	return store.db.Close()
}

// inTx runs fn in a transaction and rolls back when fn returns an error.
func (store *Store) inTx(ctx context.Context, fn func(queries *librarydb.Queries) error) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(store.queries.WithTx(tx)); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
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

	err := store.queries.ImportBook(ctx, librarydb.ImportBookParams{
		ID:         id,
		Title:      title,
		FileName:   fileName,
		SourcePath: sourcePath,
		FileHash:   fileHash,
		Format:     format,
		SizeBytes:  size,
		ImportedAt: timestamp,
		UpdatedAt:  timestamp,
	})
	if err != nil {
		return Book{}, fmt.Errorf("save imported book: %w", err)
	}
	return store.ByHash(ctx, fileHash)
}

func (store *Store) List(ctx context.Context) ([]Book, error) {
	rows, err := store.queries.ListBooks(ctx)
	if err != nil {
		return nil, fmt.Errorf("list books: %w", err)
	}
	books := make([]Book, len(rows))
	for i, row := range rows {
		books[i] = bookFromRow(row.Book, readingState{row.LastPage, row.LastCfi, row.BindingDirection})
	}
	return books, nil
}

func (store *Store) Get(ctx context.Context, id string) (Book, error) {
	row, err := store.queries.GetBook(ctx, id)
	if err != nil {
		return Book{}, bookQueryError(err)
	}
	return bookFromRow(row.Book, readingState{row.LastPage, row.LastCfi, row.BindingDirection}), nil
}

func (store *Store) ByHash(ctx context.Context, hash string) (Book, error) {
	row, err := store.queries.GetBookByHash(ctx, hash)
	if err != nil {
		return Book{}, bookQueryError(err)
	}
	return bookFromRow(row.Book, readingState{row.LastPage, row.LastCfi, row.BindingDirection}), nil
}

func bookQueryError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrBookNotFound
	}
	return fmt.Errorf("get book: %w", err)
}

func (store *Store) MarkOpened(ctx context.Context, id string, now time.Time) error {
	affected, err := store.queries.MarkBookOpened(ctx, librarydb.MarkBookOpenedParams{
		OpenedAt: now.UTC().Format(time.RFC3339Nano),
		ID:       id,
	})
	return requireChanged(affected, err, "mark book opened")
}

// SaveReadingPosition keeps the page a book was left on. For an EPUB, the page
// is the section and cfi the place in it; a PDF passes an empty cfi.
func (store *Store) SaveReadingPosition(ctx context.Context, id string, pageNumber, pageCount int, cfi string, now time.Time) error {
	if pageNumber < 1 || pageCount < 1 || pageNumber > pageCount || (cfi != "" && !validCFI(cfi)) {
		return ErrInvalidReadingPosition
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	return store.inTx(ctx, func(queries *librarydb.Queries) error {
		affected, err := queries.UpdateBookPageCount(ctx, librarydb.UpdateBookPageCountParams{
			PageCount: int64(pageCount),
			UpdatedAt: timestamp,
			ID:        id,
		})
		if err := requireChanged(affected, err, "update book page count"); err != nil {
			return err
		}
		if err := queries.UpsertReadingState(ctx, librarydb.UpsertReadingStateParams{
			BookID:     id,
			PageNumber: int64(pageNumber),
			Cfi:        cfi,
			UpdatedAt:  timestamp,
		}); err != nil {
			return fmt.Errorf("save reading position: %w", err)
		}
		return nil
	})
}

// SaveBindingDirection keeps which side a book is bound on.
func (store *Store) SaveBindingDirection(ctx context.Context, id, direction string, now time.Time) error {
	if direction != BindingLeftToRight && direction != BindingRightToLeft {
		return ErrInvalidBindingDirection
	}
	if _, err := store.queries.GetBook(ctx, id); err != nil {
		return bookQueryError(err)
	}
	if err := store.queries.UpsertBindingDirection(ctx, librarydb.UpsertBindingDirectionParams{
		BookID:           id,
		BindingDirection: direction,
		UpdatedAt:        now.UTC().Format(time.RFC3339Nano),
	}); err != nil {
		return fmt.Errorf("save binding direction: %w", err)
	}
	return nil
}

func (store *Store) SaveCover(ctx context.Context, id, path string, now time.Time) error {
	return store.setCover(ctx, id, path, "ready", now, "save book cover")
}

func (store *Store) MarkCoverFailed(ctx context.Context, id string, now time.Time) error {
	return store.setCover(ctx, id, "", "failed", now, "mark book cover failed")
}

func (store *Store) ResetCover(ctx context.Context, id string, now time.Time) error {
	return store.setCover(ctx, id, "", "pending", now, "reset book cover")
}

func (store *Store) setCover(ctx context.Context, id, path, status string, now time.Time, operation string) error {
	affected, err := store.queries.SetBookCover(ctx, librarydb.SetBookCoverParams{
		CoverThumbnailPath:   path,
		CoverThumbnailStatus: status,
		UpdatedAt:            now.UTC().Format(time.RFC3339Nano),
		ID:                   id,
	})
	return requireChanged(affected, err, operation)
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
	affected, err := store.queries.RenameBook(ctx, librarydb.RenameBookParams{
		DisplayName: trimmed,
		UpdatedAt:   now.UTC().Format(time.RFC3339Nano),
		ID:          id,
	})
	if err := requireChanged(affected, err, "rename book"); err != nil {
		return Book{}, err
	}
	return store.Get(ctx, id)
}

func (store *Store) Remove(ctx context.Context, id string) error {
	affected, err := store.queries.DeleteBook(ctx, id)
	return requireChanged(affected, err, "remove book")
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
	err = store.inTx(ctx, func(queries *librarydb.Queries) error {
		if fileHash != book.FileHash {
			if err := queries.DeleteBookSegments(ctx, id); err != nil {
				return fmt.Errorf("clear stale book segments: %w", err)
			}
		}
		return queries.RelinkBook(ctx, librarydb.RelinkBookParams{
			Title:                title,
			FileName:             fileName,
			SourcePath:           sourcePath,
			FileHash:             fileHash,
			SizeBytes:            size,
			PageCount:            int64(pageCount),
			CoverThumbnailPath:   coverPath,
			CoverThumbnailStatus: coverStatus,
			UpdatedAt:            timestamp,
			ID:                   id,
		})
	})
	if err != nil {
		return Book{}, fmt.Errorf("relink book: %w", err)
	}
	return store.Get(ctx, id)
}

func (store *Store) RecordSourceStat(ctx context.Context, id string, size int64, modTime, now time.Time) error {
	affected, err := store.queries.RecordBookSourceStat(ctx, librarydb.RecordBookSourceStatParams{
		SizeBytes:     size,
		SourceModTime: FormatSourceModTime(modTime),
		UpdatedAt:     now.UTC().Format(time.RFC3339Nano),
		ID:            id,
	})
	return requireChanged(affected, err, "record book source stat")
}

func FormatSourceModTime(modTime time.Time) string {
	return modTime.UTC().Format(time.RFC3339Nano)
}

func (store *Store) Setting(ctx context.Context, key string) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", errors.New("setting key is required")
	}
	value, err := store.queries.GetAppSetting(ctx, key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read app setting: %w", err)
	}
	return value, nil
}

func (store *Store) SaveSetting(ctx context.Context, key, value string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return errors.New("setting key is required")
	}
	if err := store.queries.UpsertAppSetting(ctx, librarydb.UpsertAppSettingParams{
		Key:       key,
		Value:     value,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}); err != nil {
		return fmt.Errorf("save app setting: %w", err)
	}
	return nil
}

var ErrBookNotFound = errors.New("book not found")

func requireChanged(affected int64, err error, operation string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if affected == 0 {
		return ErrBookNotFound
	}
	return nil
}
