package library

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStorePersistsLibraryAndReadingPosition(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Date(2026, time.June, 21, 10, 0, 0, 0, time.UTC)
	store, err := Open(path)
	require.NoError(t, err)
	var schemaVersionValue int
	require.NoError(t, store.db.QueryRow("PRAGMA user_version").Scan(&schemaVersionValue))
	assert.Equal(t, schemaVersion, schemaVersionValue)

	book, err := store.Import(context.Background(), "book-1", "/tmp/Go Guide.pdf", "hash-1", 120, now)
	require.NoError(t, err)
	assert.Equal(t, "Go Guide", book.Title)
	assert.Equal(t, 1, book.LastPage)
	assert.Equal(t, "pending", book.CoverThumbnailStatus)
	require.NoError(t, store.MarkOpened(context.Background(), book.ID, now.Add(time.Minute)))
	require.NoError(t, store.SaveReadingPosition(context.Background(), book.ID, 7, 20, now.Add(2*time.Minute)))
	require.NoError(t, store.SaveCover(context.Background(), book.ID, "/tmp/cover.png", now.Add(3*time.Minute)))
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	books, err := store.List(context.Background())
	require.NoError(t, err)
	require.Len(t, books, 1)
	persisted := books[0]
	assert.Equal(t, 7, persisted.LastPage)
	assert.Equal(t, 20, persisted.PageCount)
	assert.Equal(t, "ready", persisted.CoverThumbnailStatus)
	assert.NotEmpty(t, persisted.LastOpenedAt)
}

func TestStoreDeduplicatesByFileHashAndUpdatesLocation(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()

	first, err := store.Import(context.Background(), "book-1", "/old/Guide.pdf", "same-hash", 10, now)
	require.NoError(t, err)
	second, err := store.Import(context.Background(), "book-2", "/new/Guide.pdf", "same-hash", 11, now.Add(time.Minute))
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, "/new/Guide.pdf", second.SourcePath)
	assert.EqualValues(t, 11, second.SizeBytes)
	books, err := store.List(context.Background())
	require.NoError(t, err)
	assert.Len(t, books, 1)
}

func TestStoreValidatesUpdatesAndMissingBooks(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })

	_, err = store.Get(context.Background(), "missing")
	assert.ErrorIs(t, err, ErrBookNotFound)
	assert.Error(t, store.SaveReadingPosition(context.Background(), "missing", 0, 0, time.Now()))
	assert.ErrorIs(t, store.MarkCoverFailed(context.Background(), "missing", time.Now()), ErrBookNotFound)
}
