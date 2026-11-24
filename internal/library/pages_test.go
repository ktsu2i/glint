package library

import (
	"io/fs"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	gormsqlite "github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/kaito/glint/internal/sqlite"
	"github.com/kaito/glint/migrations"
)

func requireFTSInSync(t *testing.T, store *Store) {
	t.Helper()
	require.NoError(t, store.db.Exec(
		"INSERT INTO book_pages_fts (book_pages_fts, rank) VALUES ('integrity-check', 1)",
	).Error)
}

func TestFTSIndexFollowsPageInsertsUpdatesAndDeletes(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	_, err = store.SaveBookPages(t.Context(), book.ID, []BookPage{
		{PageNumber: 1, Text: "Goroutines and channels"},
		{PageNumber: 2, Text: "Mutexes guard shared state"},
	}, 2, now)
	require.NoError(t, err)
	requireFTSInSync(t, store)

	_, err = store.SaveBookPages(t.Context(), book.ID, []BookPage{
		{PageNumber: 1, Text: "Select statements multiplex channels"},
	}, 2, now)
	require.NoError(t, err)
	requireFTSInSync(t, store)
	stale, err := store.SearchBookPages(t.Context(), book.ID, "goroutines", 20)
	require.NoError(t, err)
	assert.Empty(t, stale, "rewritten page text must leave the index")
	fresh, err := store.SearchBookPages(t.Context(), book.ID, "multiplex", 20)
	require.NoError(t, err)
	require.Len(t, fresh, 1)
	assert.Equal(t, 1, fresh[0].PageNumber)

	_, err = store.Relink(t.Context(), book.ID, "/tmp/Guide.pdf", "hash-2", 11, now)
	require.NoError(t, err)
	requireFTSInSync(t, store)

	_, err = store.SaveBookPages(t.Context(), book.ID, []BookPage{{PageNumber: 1, Text: "Mutexes again"}}, 1, now)
	require.NoError(t, err)
	require.NoError(t, store.Remove(t.Context(), book.ID))
	requireFTSInSync(t, store)
	hits, err := store.SearchLibraryPages(t.Context(), "mutexes", 3, 10)
	require.NoError(t, err)
	assert.Empty(t, hits, "cascaded page deletes must leave the index")
}

func TestSearchMatchesJapaneseShortTermsAndCaseInsensitively(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	_, err = store.SaveBookPages(t.Context(), book.ID, []BookPage{
		{PageNumber: 1, Text: "Go の並行処理では goroutine を使う。"},
		{PageNumber: 2, Text: "並列と並行は違う。I/O を待つ。"},
		{PageNumber: 3, Text: "HTTP Server の実装"},
	}, 3, now)
	require.NoError(t, err)

	cases := []struct {
		query string
		pages []int
	}{
		{query: "並行処理", pages: []int{1}},
		{query: "並行", pages: []int{1, 2}},
		{query: "並行 goroutine", pages: []int{1}},
		{query: "GOROUTINE", pages: []int{1}},
		{query: "http server", pages: []int{3}},
		{query: "I/O", pages: []int{2}},
		{query: `"quoted"`, pages: nil},
	}
	for _, tc := range cases {
		t.Run(tc.query, func(t *testing.T) {
			results, err := store.SearchBookPages(t.Context(), book.ID, tc.query, 20)
			require.NoError(t, err)
			var pages []int
			for _, result := range results {
				pages = append(pages, result.PageNumber)
			}
			assert.ElementsMatch(t, tc.pages, pages)
		})
	}
}

func TestFTSMigrationIndexesExistingPages(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	db, err := gorm.Open(gormsqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	before := fstest.MapFS{}
	names, err := fs.Glob(migrations.FS, "*.sql")
	require.NoError(t, err)
	for _, name := range names {
		if name >= "0009" {
			continue
		}
		body, err := fs.ReadFile(migrations.FS, name)
		require.NoError(t, err)
		before[name] = &fstest.MapFile{Data: body}
	}
	require.NoError(t, (&sqlite.Migrator{DB: sqlDB, FS: before}).Up(t.Context()))
	require.NoError(t, db.Exec(`INSERT INTO books (id, title, file_name, source_path, file_hash, size_bytes, imported_at, updated_at)
        VALUES ('book-1', 'Guide', 'Guide.pdf', '/tmp/Guide.pdf', 'hash-1', 10, 'now', 'now')`).Error)
	require.NoError(t, db.Exec(`INSERT INTO book_pages (id, book_id, page_number, text, updated_at)
        VALUES ('book-1:1', 'book-1', 1, 'Context builder trims prompts', 'now'),
               ('book-1:2', 'book-1', 2, 'Unrelated page', 'now')`).Error)
	require.NoError(t, sqlDB.Close())

	store, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	requireFTSInSync(t, store)
	results, err := store.SearchBookPages(t.Context(), "book-1", "context builder", 20)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 1, results[0].PageNumber)

	_, err = store.SaveBookPages(t.Context(), "book-1", []BookPage{{PageNumber: 3, Text: "Context again"}}, 3, time.Now())
	require.NoError(t, err)
	count, err := store.BookPageCount(t.Context(), "book-1")
	require.NoError(t, err)
	assert.Equal(t, 3, count)
}
