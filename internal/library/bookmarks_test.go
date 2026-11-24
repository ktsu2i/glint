package library

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStorePersistsUniqueBookmarksAndDeletesThem(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Date(2026, 6, 23, 9, 0, 0, 0, time.UTC)
	store, err := Open(path)
	require.NoError(t, err)
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	first, err := store.SaveBookmark(t.Context(), book.ID, 7, 20, now)
	require.NoError(t, err)
	_, err = store.SaveBookmark(t.Context(), book.ID, 7, 20, now.Add(time.Minute))
	require.NoError(t, err)
	_, err = store.SaveBookmark(t.Context(), book.ID, 3, 20, now.Add(2*time.Minute))
	require.NoError(t, err)
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	bookmarks, err := store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 2)
	assert.Equal(t, []int{3, 7}, []int{bookmarks[0].PageNumber, bookmarks[1].PageNumber})
	assert.Equal(t, first.CreatedAt, bookmarks[1].CreatedAt, "saving the same page must not replace its creation time")

	require.NoError(t, store.DeleteBookmark(t.Context(), book.ID, 7))
	require.NoError(t, store.DeleteBookmark(t.Context(), book.ID, 7), "deletion is idempotent")
	bookmarks, err = store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1)
	assert.Equal(t, 3, bookmarks[0].PageNumber)
}

func TestStoreValidatesAndClearsStaleBookmarks(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	_, err = store.SaveBookmark(t.Context(), book.ID, 0, 10, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), book.ID, 11, 10, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), "missing", 1, 10, now)
	assert.ErrorIs(t, err, ErrBookNotFound)
	assert.ErrorIs(t, store.DeleteBookmark(t.Context(), book.ID, 0), ErrInvalidBookmark)
}

func TestStoreClearsBookmarksWhenPDFContentChanges(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	_, err = store.SaveBookmark(t.Context(), book.ID, 4, 10, now)
	require.NoError(t, err)

	_, err = store.Relink(t.Context(), book.ID, "/tmp/Guide.pdf", "hash-2", 11, now.Add(time.Minute))
	require.NoError(t, err)
	bookmarks, err := store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Empty(t, bookmarks)
}
