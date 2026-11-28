package library

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func pdfBookmark(page, pageCount int) NewBookmark {
	return NewBookmark{Location: PDFBookmarkLocation{Page: page}, PageCount: pageCount}
}

func TestStorePersistsUniqueBookmarksAndDeletesThem(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Date(2026, 6, 23, 9, 0, 0, 0, time.UTC)
	store, err := Open(path)
	require.NoError(t, err)
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	first, err := store.SaveBookmark(t.Context(), book.ID, pdfBookmark(7, 20), now)
	require.NoError(t, err)
	_, err = store.SaveBookmark(t.Context(), book.ID, pdfBookmark(7, 20), now.Add(time.Minute))
	require.NoError(t, err)
	_, err = store.SaveBookmark(t.Context(), book.ID, pdfBookmark(3, 20), now.Add(2*time.Minute))
	require.NoError(t, err)
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	bookmarks, err := store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 2)
	assert.Equal(t, []BookmarkLocation{PDFBookmarkLocation{Page: 3}, PDFBookmarkLocation{Page: 7}},
		[]BookmarkLocation{bookmarks[0].Location, bookmarks[1].Location})
	assert.Equal(t, first.CreatedAt, bookmarks[1].CreatedAt, "saving the same page must not replace its creation time")

	require.NoError(t, store.DeleteBookmark(t.Context(), book.ID, PDFBookmarkLocation{Page: 7}))
	require.NoError(t, store.DeleteBookmark(t.Context(), book.ID, PDFBookmarkLocation{Page: 7}), "deletion is idempotent")
	bookmarks, err = store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1)
	assert.Equal(t, PDFBookmarkLocation{Page: 3}, bookmarks[0].Location)
}

func TestStoreValidatesAndClearsStaleBookmarks(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	_, err = store.SaveBookmark(t.Context(), book.ID, pdfBookmark(0, 10), now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), book.ID, pdfBookmark(11, 10), now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), "missing", pdfBookmark(1, 10), now)
	assert.ErrorIs(t, err, ErrBookNotFound)
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{PageCount: 10}, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark, "a bookmark needs a location")
	assert.ErrorIs(t, store.DeleteBookmark(t.Context(), book.ID, PDFBookmarkLocation{Page: 0}), ErrInvalidBookmark)
	assert.ErrorIs(t, store.DeleteBookmark(t.Context(), book.ID, nil), ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{
		Location: EPUBBookmarkLocation{Section: 1, CFI: "/6/4"}, PageCount: 10,
	}, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{
		Location: EPUBBookmarkLocation{Section: 1, CFI: "epubcfi(/6/4!/4/2/1:0)", Progress: 1.5}, PageCount: 10,
	}, now)
	assert.ErrorIs(t, err, ErrInvalidBookmark)
	assert.ErrorIs(t, store.DeleteBookmark(t.Context(), book.ID, EPUBBookmarkLocation{Section: 1, CFI: "/6/4"}), ErrInvalidBookmark)
}

func TestStoreKeepsEPUBBookmarksApartByCFI(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Date(2026, 11, 26, 9, 0, 0, 0, time.UTC)
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.epub", "hash-1", "epub", 10, now)
	require.NoError(t, err)

	later := EPUBBookmarkLocation{Section: 3, CFI: "epubcfi(/6/8!/4/20/1:0)", Progress: 0.6}
	earlier := EPUBBookmarkLocation{Section: 3, CFI: "epubcfi(/6/8!/4/2/1:0)", Progress: 0.5}
	_, err = store.SaveBookmark(t.Context(), book.ID, NewBookmark{Location: later, PageCount: 5}, now)
	require.NoError(t, err)
	saved, err := store.SaveBookmark(t.Context(), book.ID, NewBookmark{Location: earlier, PageCount: 5}, now.Add(time.Minute))
	require.NoError(t, err)
	assert.Equal(t, BookBookmark{
		Location:  earlier,
		CreatedAt: now.Add(time.Minute).Format(time.RFC3339Nano),
	}, saved)

	bookmarks, err := store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 2)
	assert.Equal(t, []BookmarkLocation{earlier, later}, []BookmarkLocation{bookmarks[0].Location, bookmarks[1].Location},
		"bookmarks in a section are listed in reading order")

	require.NoError(t, store.DeleteBookmark(t.Context(), book.ID, later))
	bookmarks, err = store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1)
	assert.Equal(t, earlier, bookmarks[0].Location)
}

func TestStoreKeepsBookmarksWhenPDFContentChanges(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	_, err = store.SaveBookmark(t.Context(), book.ID, pdfBookmark(4, 10), now)
	require.NoError(t, err)

	_, err = store.Relink(t.Context(), book.ID, "/tmp/Guide.pdf", "hash-2", 11, now.Add(time.Minute))
	require.NoError(t, err)
	bookmarks, err := store.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1, "bookmarks are user data and must survive a content change")
	assert.Equal(t, PDFBookmarkLocation{Page: 4}, bookmarks[0].Location)
}
