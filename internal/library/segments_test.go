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

func pageSegment(pageNumber int, text string) BookSegment {
	return BookSegment{
		Ordinal:  pageNumber,
		Kind:     SegmentKindPage,
		Location: PageLocation(pageNumber),
		Text:     text,
	}
}

func requireFTSInSync(t *testing.T, store *Store) {
	t.Helper()
	require.NoError(t, store.db.Exec(
		"INSERT INTO book_segments_fts (book_segments_fts, rank) VALUES ('integrity-check', 1)",
	).Error)
}

func TestFTSIndexFollowsPageInsertsUpdatesAndDeletes(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	_, err = store.SaveBookSegments(t.Context(), book.ID, []BookSegment{
		pageSegment(1, "Goroutines and channels"),
		pageSegment(2, "Mutexes guard shared state"),
	}, 2, now)
	require.NoError(t, err)
	requireFTSInSync(t, store)

	_, err = store.SaveBookSegments(t.Context(), book.ID, []BookSegment{
		pageSegment(1, "Select statements multiplex channels"),
	}, 2, now)
	require.NoError(t, err)
	requireFTSInSync(t, store)
	stale, err := store.SearchBookSegments(t.Context(), book.ID, "goroutines", 20)
	require.NoError(t, err)
	assert.Empty(t, stale, "rewritten page text must leave the index")
	fresh, err := store.SearchBookSegments(t.Context(), book.ID, "multiplex", 20)
	require.NoError(t, err)
	require.Len(t, fresh, 1)
	assert.Equal(t, 1, fresh[0].Ordinal)

	_, err = store.Relink(t.Context(), book.ID, "/tmp/Guide.pdf", "hash-2", 11, now)
	require.NoError(t, err)
	requireFTSInSync(t, store)

	_, err = store.SaveBookSegments(t.Context(), book.ID, []BookSegment{pageSegment(1, "Mutexes again")}, 1, now)
	require.NoError(t, err)
	require.NoError(t, store.Remove(t.Context(), book.ID))
	requireFTSInSync(t, store)
	hits, err := store.SearchLibrarySegments(t.Context(), "mutexes", 3, 10)
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
	_, err = store.SaveBookSegments(t.Context(), book.ID, []BookSegment{
		pageSegment(1, "Go の並行処理では goroutine を使う。"),
		pageSegment(2, "並列と並行は違う。I/O を待つ。"),
		pageSegment(3, "HTTP Server の実装"),
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
			results, err := store.SearchBookSegments(t.Context(), book.ID, tc.query, 20)
			require.NoError(t, err)
			var pages []int
			for _, result := range results {
				pages = append(pages, result.Ordinal)
			}
			assert.ElementsMatch(t, tc.pages, pages)
		})
	}
}

func migrateBefore(t *testing.T, path, firstSkipped string) (*gorm.DB, func()) {
	t.Helper()
	db, err := gorm.Open(gormsqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	before := fstest.MapFS{}
	names, err := fs.Glob(migrations.FS, "*.sql")
	require.NoError(t, err)
	for _, name := range names {
		if name >= firstSkipped {
			continue
		}
		body, err := fs.ReadFile(migrations.FS, name)
		require.NoError(t, err)
		before[name] = &fstest.MapFile{Data: body}
	}
	require.NoError(t, (&sqlite.Migrator{DB: sqlDB, FS: before}).Up(t.Context()))
	return db, func() { require.NoError(t, sqlDB.Close()) }
}

func TestFTSMigrationIndexesExistingPages(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	db, closeDB := migrateBefore(t, path, "0009")
	require.NoError(t, db.Exec(`INSERT INTO books (id, title, file_name, source_path, file_hash, size_bytes, imported_at, updated_at)
        VALUES ('book-1', 'Guide', 'Guide.pdf', '/tmp/Guide.pdf', 'hash-1', 10, 'now', 'now')`).Error)
	require.NoError(t, db.Exec(`INSERT INTO book_pages (id, book_id, page_number, text, updated_at)
        VALUES ('book-1:1', 'book-1', 1, 'Context builder trims prompts', 'now'),
               ('book-1:2', 'book-1', 2, 'Unrelated page', 'now')`).Error)
	closeDB()

	store, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	requireFTSInSync(t, store)
	results, err := store.SearchBookSegments(t.Context(), "book-1", "context builder", 20)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 1, results[0].Ordinal)

	_, err = store.SaveBookSegments(t.Context(), "book-1", []BookSegment{pageSegment(3, "Context again")}, 3, time.Now())
	require.NoError(t, err)
	count, err := store.BookSegmentCount(t.Context(), "book-1")
	require.NoError(t, err)
	assert.Equal(t, 3, count)
}

func TestSegmentMigrationMapsPDFPagesAndEPUBSpineItems(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	db, closeDB := migrateBefore(t, path, "0010")
	require.NoError(t, db.Exec(`INSERT INTO books (id, title, file_name, source_path, file_hash, format, size_bytes, imported_at, updated_at)
        VALUES ('pdf-1', 'Guide', 'Guide.pdf', '/tmp/Guide.pdf', 'hash-1', 'pdf', 10, 'now', 'now'),
               ('epub-1', 'Novel', 'Novel.epub', '/tmp/Novel.epub', 'hash-2', 'epub', 10, 'now', 'now')`).Error)
	require.NoError(t, db.Exec(`INSERT INTO book_pages (id, book_id, page_number, text, updated_at)
        VALUES ('pdf-1:4', 'pdf-1', 4, 'Channels on page four', 'now'),
               ('epub-1:1', 'epub-1', 1, 'Opening chapter about channels', 'now'),
               ('epub-1:2', 'epub-1', 2, 'Second chapter', 'now')`).Error)
	closeDB()

	store, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	requireFTSInSync(t, store)

	var records []bookSegmentRecord
	require.NoError(t, store.db.Order("book_id, ordinal").Find(&records).Error)
	type row struct {
		BookID, Kind, Location string
		Ordinal                int
	}
	got := make([]row, len(records))
	for i, record := range records {
		got[i] = row{BookID: record.BookID, Kind: record.Kind, Location: record.Location, Ordinal: record.Ordinal}
	}
	assert.Equal(t, []row{
		{BookID: "epub-1", Kind: SegmentKindSection, Location: "spine:0", Ordinal: 1},
		{BookID: "epub-1", Kind: SegmentKindSection, Location: "spine:1", Ordinal: 2},
		{BookID: "pdf-1", Kind: SegmentKindPage, Location: "page:4", Ordinal: 4},
	}, got)

	hits, err := store.SearchLibrarySegments(t.Context(), "channels", 3, 10)
	require.NoError(t, err)
	require.Len(t, hits, 2)
	locations := []string{hits[0].Segments[0].Location, hits[1].Segments[0].Location}
	assert.ElementsMatch(t, []string{"spine:0", "page:4"}, locations)
}

func TestSaveBookSegmentsRejectsInvalidSegments(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, time.Now())
	require.NoError(t, err)

	for name, segment := range map[string]BookSegment{
		"unknown kind":   {Ordinal: 1, Kind: "chapter", Location: "page:1"},
		"empty location": {Ordinal: 1, Kind: SegmentKindPage},
		"ordinal zero":   {Ordinal: 0, Kind: SegmentKindPage, Location: "page:0"},
		"past total":     {Ordinal: 3, Kind: SegmentKindPage, Location: "page:3"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := store.SaveBookSegments(t.Context(), book.ID, []BookSegment{segment}, 2, time.Now())
			assert.ErrorIs(t, err, ErrInvalidSegmentBatch)
		})
	}

	_, err = store.SaveBookSegments(t.Context(), book.ID, []BookSegment{{
		Ordinal: 1, Kind: SegmentKindPage, Location: "page:1", HeadingPath: "  2章 > 2.1 節  ", Text: "Channels",
	}}, 2, time.Now())
	require.NoError(t, err)
	results, err := store.SearchBookSegments(t.Context(), book.ID, "channels", 20)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "2章 > 2.1 節", results[0].HeadingPath)
	assert.Equal(t, "page:1", results[0].Location)
}
