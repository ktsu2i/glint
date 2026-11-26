package library

import (
	"database/sql"
	"io/fs"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaito/glint/internal/sqlite"
	"github.com/kaito/glint/migrations"
)

func TestStorePersistsUniqueBookmarksAndDeletesThem(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Date(2026, 6, 23, 9, 0, 0, 0, time.UTC)
	store, err := Open(path)
	require.NoError(t, err)
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	first, err := store.SaveBookmark(t.Context(), book.ID, NewBookmark{PageNumber: 7, PageCount: 20}, now)
	require.NoError(t, err)
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{PageNumber: 7, PageCount: 20}, now.Add(time.Minute))
	require.NoError(t, err)
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{PageNumber: 3, PageCount: 20}, now.Add(2*time.Minute))
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

	require.NoError(t, store.DeleteBookmark(t.Context(), book.ID, 7, ""))
	require.NoError(t, store.DeleteBookmark(t.Context(), book.ID, 7, ""), "deletion is idempotent")
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

	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{PageNumber: 0, PageCount: 10}, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{PageNumber: 11, PageCount: 10}, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), "missing", NewBookmark{PageNumber: 1, PageCount: 10}, now)
	assert.ErrorIs(t, err, ErrBookNotFound)
	assert.ErrorIs(t, store.DeleteBookmark(t.Context(), book.ID, 0, ""), ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{PageNumber: 1, PageCount: 10, Progress: 0.5}, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark, "a PDF bookmark has no progress")
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{PageNumber: 1, PageCount: 10, CFI: "/6/4"}, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{
		PageNumber: 1, PageCount: 10, CFI: "epubcfi(/6/4!/4/2/1:0)", Progress: 1.5,
	}, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	assert.ErrorIs(t, store.DeleteBookmark(t.Context(), book.ID, 1, "/6/4"), ErrInvalidBookmark)
}

func TestStoreKeepsEPUBBookmarksApartByCFI(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 11, 26, 9, 0, 0, 0, time.UTC)
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.epub", "hash-1", "epub", 10, now)
	require.NoError(t, err)

	later := NewBookmark{PageNumber: 3, PageCount: 5, CFI: "epubcfi(/6/8!/4/20/1:0)", Progress: 0.6}
	earlier := NewBookmark{PageNumber: 3, PageCount: 5, CFI: "epubcfi(/6/8!/4/2/1:0)", Progress: 0.5}
	_, err = store.SaveBookmark(t.Context(), book.ID, later, now)
	require.NoError(t, err)
	saved, err := store.SaveBookmark(t.Context(), book.ID, earlier, now.Add(time.Minute))
	require.NoError(t, err)
	assert.Equal(t, BookBookmark{
		PageNumber: 3,
		CFI:        earlier.CFI,
		Progress:   0.5,
		CreatedAt:  now.Add(time.Minute).Format(time.RFC3339Nano),
	}, saved)

	bookmarks, err := store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 2)
	assert.Equal(t, []string{earlier.CFI, later.CFI}, []string{bookmarks[0].CFI, bookmarks[1].CFI},
		"bookmarks in a section are listed in reading order")

	require.NoError(t, store.DeleteBookmark(t.Context(), book.ID, 3, later.CFI))
	bookmarks, err = store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1)
	assert.Equal(t, earlier.CFI, bookmarks[0].CFI)
}

func TestStoreKeepsBookmarksWhenPDFContentChanges(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{PageNumber: 4, PageCount: 10}, now)
	require.NoError(t, err)

	_, err = store.Relink(t.Context(), book.ID, "/tmp/Guide.pdf", "hash-2", 11, now.Add(time.Minute))
	require.NoError(t, err)
	bookmarks, err := store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1, "bookmarks are user data and must survive a content change")
	assert.Equal(t, 4, bookmarks[0].PageNumber)
}

func TestMigrationKeepsPDFBookmarks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	db, err := sql.Open("sqlite", path)
	require.NoError(t, err)
	before := fstest.MapFS{}
	entries, err := fs.ReadDir(migrations.FS, ".")
	require.NoError(t, err)
	for _, entry := range entries {
		if entry.Name() >= "0014" {
			continue
		}
		body, err := fs.ReadFile(migrations.FS, entry.Name())
		require.NoError(t, err)
		before[entry.Name()] = &fstest.MapFile{Data: body}
	}
	require.NoError(t, (&sqlite.Migrator{DB: db, FS: before}).Up(t.Context()))
	execSQL(t, db, `INSERT INTO books (id, title, file_name, source_path, file_hash, size_bytes, imported_at, updated_at)
        VALUES ('book-1', 'Guide', 'Guide.pdf', '/tmp/Guide.pdf', 'hash-1', 10, 'now', 'now')`)
	execSQL(t, db, `INSERT INTO book_bookmarks (book_id, page_number, created_at)
        VALUES ('book-1', 4, 'saved-4'), ('book-1', 2, 'saved-2')`)
	require.NoError(t, db.Close())

	store, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	bookmarks, err := store.ListBookmarks(t.Context(), "book-1")
	require.NoError(t, err)
	assert.Equal(t, []BookBookmark{
		{PageNumber: 2, CreatedAt: "saved-2"},
		{PageNumber: 4, CreatedAt: "saved-4"},
	}, bookmarks)

	require.NoError(t, store.Remove(t.Context(), "book-1"))
	var count int
	require.NoError(t, store.db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM book_bookmarks").Scan(&count))
	assert.Zero(t, count, "bookmarks still go with their book")
}
