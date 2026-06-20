package library

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestStorePersistsLibraryAndReadingPosition(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Date(2026, time.June, 21, 10, 0, 0, 0, time.UTC)
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	var schemaVersionValue int
	if err := store.db.QueryRow("PRAGMA user_version").Scan(&schemaVersionValue); err != nil {
		t.Fatal(err)
	}
	if schemaVersionValue != schemaVersion {
		t.Fatalf("expected schema version %d, got %d", schemaVersion, schemaVersionValue)
	}

	book, err := store.Import(context.Background(), "book-1", "/tmp/Go Guide.pdf", "hash-1", 120, now)
	if err != nil {
		t.Fatal(err)
	}
	if book.Title != "Go Guide" || book.LastPage != 1 || book.CoverThumbnailStatus != "pending" {
		t.Fatalf("unexpected imported book: %#v", book)
	}
	if err := store.MarkOpened(context.Background(), book.ID, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveReadingPosition(context.Background(), book.ID, 7, 20, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveCover(context.Background(), book.ID, "/tmp/cover.png", now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	books, err := store.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(books) != 1 {
		t.Fatalf("expected one persisted book, got %d", len(books))
	}
	persisted := books[0]
	if persisted.LastPage != 7 || persisted.PageCount != 20 || persisted.CoverThumbnailStatus != "ready" {
		t.Fatalf("unexpected persisted book: %#v", persisted)
	}
	if persisted.LastOpenedAt == "" {
		t.Fatal("expected last opened timestamp")
	}
}

func TestStoreDeduplicatesByFileHashAndUpdatesLocation(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()

	first, err := store.Import(context.Background(), "book-1", "/old/Guide.pdf", "same-hash", 10, now)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Import(context.Background(), "book-2", "/new/Guide.pdf", "same-hash", 11, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID || second.SourcePath != "/new/Guide.pdf" || second.SizeBytes != 11 {
		t.Fatalf("expected existing record to be updated: %#v", second)
	}
	books, err := store.List(context.Background())
	if err != nil || len(books) != 1 {
		t.Fatalf("expected one book, got %#v, %v", books, err)
	}
}

func TestStoreValidatesUpdatesAndMissingBooks(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := store.Get(context.Background(), "missing"); !errors.Is(err, ErrBookNotFound) {
		t.Fatalf("expected ErrBookNotFound, got %v", err)
	}
	if err := store.SaveReadingPosition(context.Background(), "missing", 0, 0, time.Now()); err == nil {
		t.Fatal("expected invalid position to fail")
	}
	if err := store.MarkCoverFailed(context.Background(), "missing", time.Now()); !errors.Is(err, ErrBookNotFound) {
		t.Fatalf("expected ErrBookNotFound, got %v", err)
	}
}
