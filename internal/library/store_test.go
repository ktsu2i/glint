package library

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	gormsqlite "github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestStorePersistsLibraryAndReadingPosition(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Date(2026, time.June, 21, 10, 0, 0, 0, time.UTC)
	store, err := Open(path)
	require.NoError(t, err)
	var version int
	require.NoError(t, store.db.Raw("SELECT MAX(version) FROM schema_migrations").Row().Scan(&version))
	assert.Equal(t, 8, version)

	book, err := store.Import(t.Context(), "book-1", "/tmp/Go Guide.pdf", "hash-1", "pdf", 120, now)
	require.NoError(t, err)
	assert.Equal(t, "Go Guide", book.Title)
	assert.Equal(t, "pdf", book.Format)
	assert.Equal(t, 1, book.LastPage)
	assert.Equal(t, "pending", book.CoverThumbnailStatus)
	require.NoError(t, store.MarkOpened(t.Context(), book.ID, now.Add(time.Minute)))
	require.NoError(t, store.SaveReadingPosition(t.Context(), book.ID, 7, 20, now.Add(2*time.Minute)))
	require.NoError(t, store.SaveCover(t.Context(), book.ID, "/tmp/cover.png", now.Add(3*time.Minute)))
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	books, err := store.List(t.Context())
	require.NoError(t, err)
	require.Len(t, books, 1)
	persisted := books[0]
	assert.Equal(t, 7, persisted.LastPage)
	assert.Equal(t, 20, persisted.PageCount)
	assert.Equal(t, "ready", persisted.CoverThumbnailStatus)
	assert.NotEmpty(t, persisted.LastOpenedAt)
}

func TestStorePersistsNonSecretAppSettings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	store, err := Open(path)
	require.NoError(t, err)

	value, err := store.Setting(t.Context(), "missing")
	require.NoError(t, err)
	assert.Empty(t, value)
	require.NoError(t, store.SaveSetting(t.Context(), "appearance.theme", "dark"))
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	value, err = store.Setting(t.Context(), "appearance.theme")
	require.NoError(t, err)
	assert.Equal(t, "dark", value)
}

func TestStoreUpgradesLegacyMigrationTable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	db, err := gorm.Open(gormsqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        source_path TEXT NOT NULL,
        file_hash TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 0,
        cover_thumbnail_path TEXT NOT NULL DEFAULT '',
        cover_thumbnail_status TEXT NOT NULL DEFAULT 'pending',
        imported_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
    )`).Error)
	require.NoError(t, db.Exec(`CREATE TABLE book_reading_states (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
    )`).Error)
	require.NoError(t, db.Exec(`CREATE TABLE schema_migrations (
        version INTEGER NOT NULL PRIMARY KEY,
        dirty BOOLEAN NOT NULL
    )`).Error)
	require.NoError(t, db.Exec("INSERT INTO schema_migrations (version, dirty) VALUES (1, 0)").Error)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())

	store, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	var version int
	require.NoError(t, store.db.Raw("SELECT MAX(version) FROM schema_migrations").Row().Scan(&version))
	assert.Equal(t, 8, version)
	var settingsTable string
	require.NoError(t, store.db.Raw("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'").Row().Scan(&settingsTable))
	assert.Equal(t, "app_settings", settingsTable)
}

func TestStoreDeduplicatesByFileHashAndUpdatesLocation(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()

	first, err := store.Import(t.Context(), "book-1", "/old/Guide.pdf", "same-hash", "pdf", 10, now)
	require.NoError(t, err)
	second, err := store.Import(t.Context(), "book-2", "/new/Guide.pdf", "same-hash", "pdf", 11, now.Add(time.Minute))
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, "/new/Guide.pdf", second.SourcePath)
	assert.EqualValues(t, 11, second.SizeBytes)
	books, err := store.List(t.Context())
	require.NoError(t, err)
	assert.Len(t, books, 1)
}

func TestStoreRemoveDeletesBookAndReadingState(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()

	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	require.NoError(t, store.SaveReadingPosition(t.Context(), book.ID, 4, 10, now))
	_, err = store.SaveBookPages(t.Context(), book.ID, []BookPage{{
		PageNumber: 1, Text: "persisted text", Width: 612, Height: 792,
	}}, 10, now)
	require.NoError(t, err)

	require.NoError(t, store.Remove(t.Context(), book.ID))
	_, err = store.Get(t.Context(), book.ID)
	assert.ErrorIs(t, err, ErrBookNotFound)
	assert.ErrorIs(t, store.Remove(t.Context(), book.ID), ErrBookNotFound)

	var remaining int
	require.NoError(t, store.db.Raw("SELECT COUNT(*) FROM book_reading_states WHERE book_id = ?", book.ID).Row().Scan(&remaining))
	assert.Equal(t, 0, remaining)
	require.NoError(t, store.db.Raw("SELECT COUNT(*) FROM book_pages WHERE book_id = ?", book.ID).Row().Scan(&remaining))
	assert.Equal(t, 0, remaining)
}

func TestStoreSavesAndSearchesBookPages(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Search.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	count, err := store.SaveBookPages(t.Context(), book.ID, []BookPage{
		{PageNumber: 1, Text: "A context builder keeps requests focused.", Width: 612, Height: 792},
		{PageNumber: 2, Text: "Context builder. Context builder. Evidence remains visible.", Width: 612, Height: 792},
		{PageNumber: 3, Text: "日本語の全文検索でも文中の検索語を見つける。", Width: 612, Height: 792},
		{PageNumber: 4, Text: "A literal %_ token must not become a wildcard.", Width: 612, Height: 792},
	}, 4, now)
	require.NoError(t, err)
	assert.Equal(t, 4, count)

	results, err := store.SearchBookPages(t.Context(), book.ID, "CONTEXT builder", 20)
	require.NoError(t, err)
	require.Len(t, results, 2)
	assert.Equal(t, 2, results[0].PageNumber, "more phrase occurrences should rank first")
	assert.Contains(t, results[0].Excerpt, "Evidence remains visible")
	assert.GreaterOrEqual(t, results[0].MatchCount, 4)

	results, err = store.SearchBookPages(t.Context(), book.ID, "検索語", 20)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 3, results[0].PageNumber)
	results, err = store.SearchBookPages(t.Context(), book.ID, "%_", 20)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 4, results[0].PageNumber)

	count, err = store.SaveBookPages(t.Context(), book.ID, []BookPage{
		{PageNumber: 2, Text: "This page was replaced.", Width: 600, Height: 800},
	}, 4, now.Add(time.Minute))
	require.NoError(t, err)
	assert.Equal(t, 4, count)
	results, err = store.SearchBookPages(t.Context(), book.ID, "context builder", 20)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 1, results[0].PageNumber)
}

func TestStorePersistsBookPagesAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Now()
	store, err := Open(path)
	require.NoError(t, err)
	book, err := store.Import(t.Context(), "book-1", "/tmp/Persistent Search.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	_, err = store.SaveBookPages(t.Context(), book.ID, []BookPage{
		{PageNumber: 1, Text: "Persistent lexical evidence.", Width: 612, Height: 792},
	}, 1, now)
	require.NoError(t, err)
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	count, err := store.BookPageCount(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, count)
	results, err := store.SearchBookPages(t.Context(), book.ID, "lexical evidence", 20)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 1, results[0].PageNumber)
}

func TestStoreClearsIndexedPagesWhenPDFContentChanges(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	_, err = store.SaveBookPages(t.Context(), book.ID, []BookPage{
		{PageNumber: 1, Text: "stale index", Width: 612, Height: 792},
	}, 1, now)
	require.NoError(t, err)

	relinked, err := store.Relink(t.Context(), book.ID, "/tmp/Guide.pdf", "hash-2", 11, now.Add(time.Minute))
	require.NoError(t, err)
	assert.Equal(t, 0, relinked.PageCount)
	count, err := store.BookPageCount(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Zero(t, count)
}

func TestStoreSearchesLibraryAcrossBooks(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()

	guide, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	cookbook, err := store.Import(t.Context(), "book-2", "/tmp/Cookbook.pdf", "hash-2", "pdf", 10, now)
	require.NoError(t, err)
	notes, err := store.Import(t.Context(), "book-3", "/tmp/Notes.pdf", "hash-3", "pdf", 10, now)
	require.NoError(t, err)

	_, err = store.SaveBookPages(t.Context(), guide.ID, []BookPage{
		{PageNumber: 1, Text: "Context builder filters what gets sent.", Width: 612, Height: 792},
		{PageNumber: 2, Text: "Mention of context builder once more.", Width: 612, Height: 792},
	}, 2, now)
	require.NoError(t, err)
	_, err = store.SaveBookPages(t.Context(), cookbook.ID, []BookPage{
		{PageNumber: 1, Text: "Context builder. Context builder. Context builder.", Width: 612, Height: 792},
	}, 1, now)
	require.NoError(t, err)
	_, err = store.SaveBookPages(t.Context(), notes.ID, []BookPage{
		{PageNumber: 1, Text: "Unrelated lexical evidence about retrieval.", Width: 612, Height: 792},
	}, 1, now)
	require.NoError(t, err)

	hits, err := store.SearchLibraryPages(t.Context(), "context builder", 3, 10)
	require.NoError(t, err)
	require.Len(t, hits, 2, "only matching books should be returned")
	assert.Equal(t, cookbook.ID, hits[0].BookID, "book with denser phrase matches ranks first")
	assert.GreaterOrEqual(t, hits[0].TotalMatches, 3)
	assert.NotEmpty(t, hits[0].Pages)
	assert.Equal(t, guide.ID, hits[1].BookID)
	assert.Len(t, hits[1].Pages, 2, "both matching pages from a book are kept under the per-book cap")

	limited, err := store.SearchLibraryPages(t.Context(), "context builder", 1, 10)
	require.NoError(t, err)
	require.Len(t, limited, 2)
	assert.Len(t, limited[1].Pages, 1, "pagesPerBook caps the number of pages returned")

	capped, err := store.SearchLibraryPages(t.Context(), "context builder", 3, 1)
	require.NoError(t, err)
	require.Len(t, capped, 1, "bookLimit caps the number of books returned")
	assert.Equal(t, cookbook.ID, capped[0].BookID)

	_, err = store.SearchLibraryPages(t.Context(), "   ", 3, 10)
	assert.ErrorIs(t, err, ErrInvalidBookSearchQuery)
	empty, err := store.SearchLibraryPages(t.Context(), "nonexistent_term", 3, 10)
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestStoreValidatesBookPageAndSearchInputs(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, time.Now())
	require.NoError(t, err)

	_, err = store.SaveBookPages(t.Context(), book.ID, nil, 1, time.Now())
	assert.ErrorIs(t, err, ErrInvalidBookPageBatch)
	_, err = store.SaveBookPages(t.Context(), book.ID, []BookPage{{PageNumber: 2}}, 1, time.Now())
	assert.ErrorIs(t, err, ErrInvalidBookPageBatch)
	_, err = store.SearchBookPages(t.Context(), book.ID, "   ", 20)
	assert.ErrorIs(t, err, ErrInvalidBookSearchQuery)
	_, err = store.SearchBookPages(t.Context(), "missing", "query", 20)
	assert.ErrorIs(t, err, ErrBookNotFound)
}

func TestStoreRenamesBookDisplayNameIndependentlyOfFileName(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()

	book, err := store.Import(t.Context(), "book-1", "/tmp/Go Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	assert.Equal(t, "Go Guide", book.Display())
	assert.Empty(t, book.DisplayName)

	renamed, err := store.Rename(t.Context(), book.ID, "  Real Title  ", now.Add(time.Minute))
	require.NoError(t, err)
	assert.Equal(t, "Real Title", renamed.DisplayName)
	assert.Equal(t, "Go Guide", renamed.Title, "title still tracks the original file name")
	assert.Equal(t, "Real Title", renamed.Display())

	relinked, err := store.Relink(t.Context(), book.ID, "/new/Different Name.pdf", "hash-2", 11, now.Add(2*time.Minute))
	require.NoError(t, err)
	assert.Equal(t, "Different Name", relinked.Title)
	assert.Equal(t, "Real Title", relinked.DisplayName, "relink must not clobber a user-edited display name")
	assert.Equal(t, "Real Title", relinked.Display())

	_, err = store.Rename(t.Context(), book.ID, "   ", now.Add(3*time.Minute))
	assert.ErrorIs(t, err, ErrInvalidDisplayName)
	_, err = store.Rename(t.Context(), book.ID, strings.Repeat("あ", MaxDisplayNameLength+1), now.Add(4*time.Minute))
	assert.ErrorIs(t, err, ErrInvalidDisplayName)
	_, err = store.Rename(t.Context(), "missing", "ignored", now.Add(5*time.Minute))
	assert.ErrorIs(t, err, ErrBookNotFound)
}

func TestStoreValidatesUpdatesAndMissingBooks(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })

	_, err = store.Get(t.Context(), "missing")
	assert.ErrorIs(t, err, ErrBookNotFound)
	assert.Error(t, store.SaveReadingPosition(t.Context(), "missing", 0, 0, time.Now()))
	assert.ErrorIs(t, store.MarkCoverFailed(t.Context(), "missing", time.Now()), ErrBookNotFound)
}

func TestStorePersistsBookFormatAndRejectsUnknownFormat(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()

	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", BookFormatPDF, 10, now)
	require.NoError(t, err)
	assert.Equal(t, BookFormatPDF, book.Format)

	fetched, err := store.Get(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, BookFormatPDF, fetched.Format)

	books, err := store.List(t.Context())
	require.NoError(t, err)
	require.Len(t, books, 1)
	assert.Equal(t, BookFormatPDF, books[0].Format)

	_, err = store.Import(t.Context(), "book-2", "/tmp/Other.bin", "hash-2", "mobi", 10, now)
	assert.Error(t, err)
}

func TestStoreReopeningAppliesFormatMigrationIdempotently(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	store, err := Open(path)
	require.NoError(t, err)
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })

	var version int
	require.NoError(t, store.db.Raw("SELECT MAX(version) FROM schema_migrations").Row().Scan(&version))
	assert.Equal(t, 8, version)

	var defaultValue string
	require.NoError(t, store.db.Raw(
		"SELECT dflt_value FROM pragma_table_info('books') WHERE name = 'format'",
	).Row().Scan(&defaultValue))
	assert.Contains(t, defaultValue, "pdf", "format column must default to pdf so legacy rows remain readable")
}

func TestStoreNewDefersDatabaseCreationUntilConnect(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "Glint")
	path := filepath.Join(directory, "library.sqlite3")

	store := New(path)
	t.Cleanup(func() { _ = store.Close() })
	assert.NoDirExists(t, directory)
	require.NoError(t, store.Close())

	require.NoError(t, store.Connect())
	assert.FileExists(t, path)
	value, err := store.Setting(t.Context(), "missing")
	require.NoError(t, err)
	assert.Empty(t, value)

	db := store.db
	require.NoError(t, store.Connect())
	assert.Same(t, db, store.db)
}
