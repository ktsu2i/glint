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

	_ "modernc.org/sqlite"
)

const schemaVersion = 1

const schema = `
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    source_path TEXT NOT NULL,
    file_hash TEXT NOT NULL UNIQUE,
    size_bytes INTEGER NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0,
    cover_thumbnail_path TEXT NOT NULL DEFAULT '',
    cover_thumbnail_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (cover_thumbnail_status IN ('pending', 'ready', 'failed')),
    imported_at TEXT NOT NULL,
    last_opened_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_reading_states (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);
`

type Store struct {
	db *sql.DB
}

type Book struct {
	ID                   string
	Title                string
	FileName             string
	SourcePath           string
	FileHash             string
	SizeBytes            int64
	PageCount            int
	CoverThumbnailPath   string
	CoverThumbnailStatus string
	ImportedAt           string
	LastOpenedAt         string
	LastPage             int
}

func Open(path string) (*Store, error) {
	if err := ensureParentDirectory(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open library database: %w", err)
	}
	db.SetMaxOpenConns(1)

	store := &Store{db: db}
	if err := store.migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
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
	for _, statement := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
		"PRAGMA journal_mode = WAL",
	} {
		if _, err := store.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("migrate library database: %w", err)
		}
	}
	var version int
	if err := store.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read library schema version: %w", err)
	}
	if version > schemaVersion {
		return fmt.Errorf("library schema version %d is newer than supported version %d", version, schemaVersion)
	}
	if version == 0 {
		tx, err := store.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin library migration: %w", err)
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx, schema); err != nil {
			return fmt.Errorf("apply library schema version 1: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 1"); err != nil {
			return fmt.Errorf("record library schema version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit library migration: %w", err)
		}
	}
	return nil
}

func (store *Store) Close() error {
	if store == nil || store.db == nil {
		return nil
	}
	return store.db.Close()
}

func (store *Store) Import(ctx context.Context, id, sourcePath, fileHash string, size int64, now time.Time) (Book, error) {
	if id == "" || sourcePath == "" || fileHash == "" {
		return Book{}, errors.New("book id, source path, and file hash are required")
	}
	fileName := filepath.Base(sourcePath)
	title := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	timestamp := now.UTC().Format(time.RFC3339Nano)

	_, err := store.db.ExecContext(ctx, `
        INSERT INTO books (
            id, title, file_name, source_path, file_hash, size_bytes,
            cover_thumbnail_status, imported_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
		ON CONFLICT(file_hash) DO UPDATE SET
			title = excluded.title,
			source_path = excluded.source_path,
            file_name = excluded.file_name,
            size_bytes = excluded.size_bytes,
            updated_at = excluded.updated_at
    `, id, title, fileName, sourcePath, fileHash, size, timestamp, timestamp)
	if err != nil {
		return Book{}, fmt.Errorf("save imported book: %w", err)
	}
	return store.ByHash(ctx, fileHash)
}

func (store *Store) List(ctx context.Context) ([]Book, error) {
	rows, err := store.db.QueryContext(ctx, `
        SELECT b.id, b.title, b.file_name, b.source_path, b.file_hash,
               b.size_bytes, b.page_count, b.cover_thumbnail_path,
               b.cover_thumbnail_status, b.imported_at, b.last_opened_at,
               COALESCE(r.page_number, 1)
          FROM books b
          LEFT JOIN book_reading_states r ON r.book_id = b.id
         ORDER BY CASE WHEN b.last_opened_at = '' THEN 1 ELSE 0 END,
                  b.last_opened_at DESC,
                  b.imported_at DESC
    `)
	if err != nil {
		return nil, fmt.Errorf("list books: %w", err)
	}
	defer rows.Close()

	var books []Book
	for rows.Next() {
		book, err := scanBook(rows)
		if err != nil {
			return nil, fmt.Errorf("scan book: %w", err)
		}
		books = append(books, book)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate books: %w", err)
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
	row := store.db.QueryRowContext(ctx, `
        SELECT b.id, b.title, b.file_name, b.source_path, b.file_hash,
               b.size_bytes, b.page_count, b.cover_thumbnail_path,
               b.cover_thumbnail_status, b.imported_at, b.last_opened_at,
               COALESCE(r.page_number, 1)
          FROM books b
          LEFT JOIN book_reading_states r ON r.book_id = b.id
         WHERE `+where, value)
	book, err := scanBook(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Book{}, ErrBookNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("get book: %w", err)
	}
	return book, nil
}

func (store *Store) MarkOpened(ctx context.Context, id string, now time.Time) error {
	result, err := store.db.ExecContext(ctx,
		"UPDATE books SET last_opened_at = ?, updated_at = ? WHERE id = ?",
		now.UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano), id,
	)
	return requireChanged(result, err, "mark book opened")
}

func (store *Store) SaveReadingPosition(ctx context.Context, id string, pageNumber, pageCount int, now time.Time) error {
	if pageNumber < 1 || pageCount < 1 || pageNumber > pageCount {
		return errors.New("reading position is outside the document")
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin reading position update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(ctx,
		"UPDATE books SET page_count = ?, updated_at = ? WHERE id = ?",
		pageCount, timestamp, id,
	)
	if err := requireChanged(result, err, "update book page count"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
        INSERT INTO book_reading_states (book_id, page_number, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(book_id) DO UPDATE SET
            page_number = excluded.page_number,
            updated_at = excluded.updated_at
    `, id, pageNumber, timestamp); err != nil {
		return fmt.Errorf("save reading position: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit reading position: %w", err)
	}
	return nil
}

func (store *Store) SaveCover(ctx context.Context, id, path string, now time.Time) error {
	result, err := store.db.ExecContext(ctx, `
        UPDATE books
           SET cover_thumbnail_path = ?, cover_thumbnail_status = 'ready', updated_at = ?
         WHERE id = ?
    `, path, now.UTC().Format(time.RFC3339Nano), id)
	return requireChanged(result, err, "save book cover")
}

func (store *Store) MarkCoverFailed(ctx context.Context, id string, now time.Time) error {
	result, err := store.db.ExecContext(ctx, `
        UPDATE books
           SET cover_thumbnail_path = '', cover_thumbnail_status = 'failed', updated_at = ?
         WHERE id = ?
    `, now.UTC().Format(time.RFC3339Nano), id)
	return requireChanged(result, err, "mark book cover failed")
}

func (store *Store) ResetCover(ctx context.Context, id string, now time.Time) error {
	result, err := store.db.ExecContext(ctx, `
        UPDATE books
           SET cover_thumbnail_path = '', cover_thumbnail_status = 'pending', updated_at = ?
         WHERE id = ?
    `, now.UTC().Format(time.RFC3339Nano), id)
	return requireChanged(result, err, "reset book cover")
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
	_, err = store.db.ExecContext(ctx, `
        UPDATE books
           SET title = ?, file_name = ?, source_path = ?, file_hash = ?, size_bytes = ?,
               cover_thumbnail_path = ?, cover_thumbnail_status = ?, updated_at = ?
         WHERE id = ?
    `, strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath)), filepath.Base(sourcePath),
		sourcePath, fileHash, size, coverPath, coverStatus, timestamp, id)
	if err != nil {
		return Book{}, fmt.Errorf("relink book: %w", err)
	}
	return store.Get(ctx, id)
}

var ErrBookNotFound = errors.New("book not found")

type rowScanner interface {
	Scan(dest ...any) error
}

func scanBook(row rowScanner) (Book, error) {
	var book Book
	err := row.Scan(
		&book.ID, &book.Title, &book.FileName, &book.SourcePath, &book.FileHash,
		&book.SizeBytes, &book.PageCount, &book.CoverThumbnailPath,
		&book.CoverThumbnailStatus, &book.ImportedAt, &book.LastOpenedAt, &book.LastPage,
	)
	return book, err
}

func requireChanged(result sql.Result, err error, operation string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s: inspect result: %w", operation, err)
	}
	if changed == 0 {
		return ErrBookNotFound
	}
	return nil
}
