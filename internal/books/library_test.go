package books

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/library"
)

type harness struct {
	t       *testing.T
	root    string
	dataDir string
	store   *library.Store
	assets  *assetserver.Server
	service *Service
	books   *Library
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	store, err := library.Open(filepath.Join(dataDir, "library.sqlite3"))
	require.NoError(t, err)
	assets := assetserver.New()
	service := New(store, assets, dataDir, nil)
	t.Cleanup(func() { _ = store.Close() })
	return &harness{t: t, root: root, dataDir: dataDir, store: store, assets: assets, service: service, books: service.books}
}

func pdfSegment(pageNumber int, text string) BookSegmentInput {
	return BookSegmentInput{Ordinal: pageNumber, Location: library.PageLocation(pageNumber), Text: text}
}

func (h *harness) writePDF(name, body string) string {
	path := filepath.Join(h.root, name)
	require.NoError(h.t, os.WriteFile(path, []byte(body), 0o600))
	return path
}

func TestSelectPDFRegistersAssetAndReturnsBookFile(t *testing.T) {
	h := newHarness(t)
	content := "%PDF-1.7\nfixture"
	path := h.writePDF("sample.pdf", content)

	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	assert.Equal(t, "sample.pdf", book.Name)
	assert.True(t, strings.HasPrefix(book.URL, assetserver.BookRoutePrefix))

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, book.URL, nil)
	response := httptest.NewRecorder()
	h.assets.ServeHTTP(response, request)
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, content, response.Body.String())
}

func TestSelectPDFRejectsInvalidHeader(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("invalid.pdf", "not a pdf")
	_, err := h.books.ImportBook(t.Context(), path)
	assert.Error(t, err)
}

func TestLibraryPersistsBooksCoverAndReadingPosition(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	path := filepath.Join(root, "Persistent Guide.pdf")
	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nfixture"), 0o600))

	store, err := library.Open(filepath.Join(dataDir, "library.sqlite3"))
	require.NoError(t, err)
	assets := assetserver.New()
	lib := NewLibrary(store, assets, dataDir)

	book, err := lib.ImportBook(t.Context(), path)
	require.NoError(t, err)
	assert.NotEmpty(t, book.ID)
	assert.Equal(t, "Persistent Guide", book.Title)
	assert.Equal(t, 1, book.InitialPage)
	require.NoError(t, lib.SaveReadingPosition(t.Context(), book.ID, 3, 8))
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	require.NoError(t, lib.SaveBookCover(t.Context(), book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)))
	require.NoError(t, store.Close())

	store, err = library.Open(filepath.Join(dataDir, "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	assets = assetserver.New()
	lib = NewLibrary(store, assets, dataDir)

	books, err := lib.ListBooks(t.Context())
	require.NoError(t, err)
	require.Len(t, books, 1)
	summary := books[0]
	assert.Equal(t, 3, summary.LastPage)
	assert.Equal(t, 8, summary.PageCount)
	assert.Equal(t, "ready", summary.CoverStatus)
	assert.NotEmpty(t, summary.CoverURL)
	assert.True(t, summary.Available)
	opened, err := lib.OpenBook(t.Context(), summary.ID)
	require.NoError(t, err)
	assert.Equal(t, 3, opened.InitialPage)

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, summary.CoverURL, nil)
	response := httptest.NewRecorder()
	assets.ServeHTTP(response, request)
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "image/png", response.Header().Get("Content-Type"))
}

func TestLibraryReportsMissingSourceWithoutExposingPath(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Moved.pdf", "%PDF-1.7\nfixture")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	require.NoError(t, os.Remove(path))
	books, err := h.books.ListBooks(t.Context())
	require.NoError(t, err)
	require.Len(t, books, 1)
	assert.False(t, books[0].Available)
	_, err = h.books.OpenBook(t.Context(), book.ID)
	assert.ErrorIs(t, err, ErrBookFileMissing)
	assert.NotContains(t, err.Error(), path)
}

func TestRemoveBookDeletesRecordAndCoverButKeepsSourcePDF(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Removable.pdf", "%PDF-1.7\nfixture")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	require.NoError(t, h.books.SaveBookCover(t.Context(), book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)))
	covers, err := filepath.Glob(filepath.Join(h.dataDir, "covers", "*.png"))
	require.NoError(t, err)
	require.Len(t, covers, 1)

	require.NoError(t, h.books.RemoveBook(t.Context(), book.ID))

	summaries, err := h.books.ListBooks(t.Context())
	require.NoError(t, err)
	assert.Empty(t, summaries)
	_, err = os.Stat(covers[0])
	assert.True(t, os.IsNotExist(err))
	_, err = os.Stat(path)
	assert.NoError(t, err, "RemoveBook must not delete the user's source PDF")
	assert.ErrorIs(t, h.books.RemoveBook(t.Context(), book.ID), library.ErrBookNotFound)
}

func TestRenameBookUpdatesDisplayedTitleWithoutTouchingFileName(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Original Title.pdf", "%PDF-1.7\nfixture")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	assert.Equal(t, "Original Title", book.Title)
	assert.Equal(t, "Original Title.pdf", book.Name)

	summary, err := h.books.RenameBook(t.Context(), book.ID, "  My Custom Name  ")
	require.NoError(t, err)
	assert.Equal(t, "My Custom Name", summary.Title)
	assert.Equal(t, "Original Title.pdf", summary.FileName, "file name must keep tracking the PDF on disk")

	listed, err := h.books.ListBooks(t.Context())
	require.NoError(t, err)
	require.Len(t, listed, 1)
	assert.Equal(t, "My Custom Name", listed[0].Title)
	assert.Equal(t, "Original Title.pdf", listed[0].FileName)

	opened, err := h.books.OpenBook(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, "My Custom Name", opened.Title)

	_, err = h.books.RenameBook(t.Context(), book.ID, "   ")
	assert.Error(t, err)
	_, err = h.books.RenameBook(t.Context(), "missing", "anything")
	assert.Error(t, err)
}

func TestSaveBookCoverRejectsInvalidContent(t *testing.T) {
	h := newHarness(t)
	assert.Error(t, h.books.SaveBookCover(t.Context(), "missing", "data:text/plain;base64,SGk="))
}

func TestLibraryRegeneratesCoverWhenCacheOrPDFChanges(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Changing.pdf", "%PDF-1.7\nfirst")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	require.NoError(t, h.books.SaveBookCover(t.Context(), book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)))
	covers, err := filepath.Glob(filepath.Join(h.dataDir, "covers", "*.png"))
	require.NoError(t, err)
	require.Len(t, covers, 1)
	require.NoError(t, os.Remove(covers[0]))
	summaries, err := h.books.ListBooks(t.Context())
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	assert.Equal(t, "pending", summaries[0].CoverStatus)
	assert.Empty(t, summaries[0].CoverURL)

	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nsecond version"), 0o600))
	opened, err := h.books.OpenBook(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, "pending", opened.CoverStatus)
	assert.Greater(t, opened.Size, book.Size)
}

func TestLibraryIndexesAndSearchesBookPages(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Searchable.pdf", "%PDF-1.7\nfixture")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	assert.Zero(t, book.IndexedPageCount)

	count, err := h.books.SaveBookSegments(t.Context(), book.ID, []BookSegmentInput{
		pdfSegment(1, "Evidence from the first page."),
		pdfSegment(2, "A retrieval pipeline returns evidence."),
	}, 2)
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	results, err := h.books.SearchBook(t.Context(), book.ID, "retrieval evidence")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 2, results[0].PageNumber)
	assert.Equal(t, "page:2", results[0].Location)

	opened, err := h.books.OpenBook(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, 2, opened.IndexedPageCount)
	_, err = h.books.SearchBook(t.Context(), book.ID, "   ")
	assert.Error(t, err)
}

func TestLibrarySearchesLibraryAcrossBooks(t *testing.T) {
	h := newHarness(t)
	guidePath := h.writePDF("Guide.pdf", "%PDF-1.7\nguide")
	cookbookPath := h.writePDF("Cookbook.pdf", "%PDF-1.7\ncookbook")
	notesPath := h.writePDF("Notes.pdf", "%PDF-1.7\nnotes")

	guide, err := h.books.ImportBook(t.Context(), guidePath)
	require.NoError(t, err)
	cookbook, err := h.books.ImportBook(t.Context(), cookbookPath)
	require.NoError(t, err)
	notes, err := h.books.ImportBook(t.Context(), notesPath)
	require.NoError(t, err)

	_, err = h.books.SaveBookSegments(t.Context(), guide.ID, []BookSegmentInput{
		pdfSegment(1, "Context builder filters what gets sent."),
		pdfSegment(2, "Mention of context builder once more."),
	}, 2)
	require.NoError(t, err)
	_, err = h.books.SaveBookSegments(t.Context(), cookbook.ID, []BookSegmentInput{
		pdfSegment(1, "Context builder. Context builder. Context builder."),
	}, 1)
	require.NoError(t, err)
	_, err = h.books.SaveBookSegments(t.Context(), notes.ID, []BookSegmentInput{
		pdfSegment(1, "Unrelated lexical evidence about retrieval."),
	}, 1)
	require.NoError(t, err)

	hits, err := h.books.SearchLibrary(t.Context(), "context builder")
	require.NoError(t, err)
	require.Len(t, hits, 2, "only matching books should be returned")
	assert.Equal(t, cookbook.ID, hits[0].Book.ID)
	assert.NotEmpty(t, hits[0].Book.Title)
	assert.GreaterOrEqual(t, hits[0].TotalMatches, 3)
	assert.NotEmpty(t, hits[0].Pages)
	assert.Equal(t, guide.ID, hits[1].Book.ID)
	assert.Len(t, hits[1].Pages, 2)

	_, err = h.books.SearchLibrary(t.Context(), "   ")
	assert.Error(t, err)
	empty, err := h.books.SearchLibrary(t.Context(), "nonexistent_term")
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestLibraryImportsEPUBAndIndexesSpine(t *testing.T) {
	h := newHarness(t)
	path := newSampleEPUB(t)

	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	assert.Equal(t, BookFormatEPUB, book.Format)
	assert.Len(t, book.SpineItems, 3)
	assert.Equal(t, 3, book.IndexedPageCount)

	results, err := h.books.SearchBook(t.Context(), book.ID, "retrieval pipeline")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 2, results[0].PageNumber)
	assert.Equal(t, "spine:1", results[0].Location)

	summaries, err := h.books.ListBooks(t.Context())
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	assert.Equal(t, BookFormatEPUB, summaries[0].Format)
	assert.Equal(t, "ready", summaries[0].CoverStatus)
	assert.NotEmpty(t, summaries[0].CoverURL)

	covers, err := filepath.Glob(filepath.Join(h.dataDir, "covers", book.ID+"-*.png"))
	require.NoError(t, err)
	require.Len(t, covers, 1)
}

func TestLibraryRejectsDRMProtectedEPUB(t *testing.T) {
	h := newHarness(t)
	path := newSampleEPUB(t, func(files map[string]string) {
		files["META-INF/encryption.xml"] = "<encryption xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"></encryption>"
	})

	_, err := h.books.ImportBook(t.Context(), path)
	assert.ErrorIs(t, err, ErrEPUBDRMProtected)
}

func TestLibraryPersistsPageBookmarks(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Bookmarks.pdf", "%PDF-1.7\nfixture")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)

	saved, err := h.books.AddBookmark(t.Context(), book.ID, 5, 12)
	require.NoError(t, err)
	assert.Equal(t, 5, saved.PageNumber)
	assert.NotEmpty(t, saved.CreatedAt)
	_, err = h.books.AddBookmark(t.Context(), book.ID, 13, 12)
	assert.Error(t, err)

	bookmarks, err := h.books.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1)
	assert.Equal(t, 5, bookmarks[0].PageNumber)
	require.NoError(t, h.books.RemoveBookmark(t.Context(), book.ID, 5))
	bookmarks, err = h.books.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Empty(t, bookmarks)
}

func TestOpenBookSkipsHashingWhenSizeAndModTimeAreUnchanged(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Stable.pdf", "%PDF-1.7\nfirst")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	_, err = h.books.SaveBookSegments(t.Context(), book.ID, []BookSegmentInput{pdfSegment(1, "indexed")}, 1)
	require.NoError(t, err)
	info, err := os.Stat(path)
	require.NoError(t, err)

	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nfirsT"), 0o600))
	require.NoError(t, os.Chtimes(path, info.ModTime(), info.ModTime()))
	opened, err := h.books.OpenBook(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, opened.IndexedPageCount, "same size and mtime must be trusted without rehashing")

	require.NoError(t, os.Chtimes(path, info.ModTime(), info.ModTime().Add(time.Second)))
	opened, err = h.books.OpenBook(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Zero(t, opened.IndexedPageCount, "a newer mtime triggers a rehash that detects the new content")
}

func TestOpenBookRecordsModTimeWhenOnlyModTimeChanges(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Touched.pdf", "%PDF-1.7\nfixture")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	_, err = h.books.SaveBookSegments(t.Context(), book.ID, []BookSegmentInput{pdfSegment(1, "indexed")}, 1)
	require.NoError(t, err)

	touched := time.Now().Add(time.Hour)
	require.NoError(t, os.Chtimes(path, touched, touched))
	opened, err := h.books.OpenBook(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, opened.IndexedPageCount, "same content keeps the index")

	stored, err := h.store.Get(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, library.FormatSourceModTime(touched), stored.SourceModTime)
}

func TestOpenBookKeepsBookmarksWhenContentChanges(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Revised.pdf", "%PDF-1.7\nfirst edition")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)
	_, err = h.books.AddBookmark(t.Context(), book.ID, 3, 10)
	require.NoError(t, err)

	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nsecond edition, revised"), 0o600))
	_, err = h.books.OpenBook(t.Context(), book.ID)
	require.NoError(t, err)

	bookmarks, err := h.books.ListBookmarks(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1)
	assert.Equal(t, 3, bookmarks[0].PageNumber)
}

func TestOpenBookLoadsEPUBSpineWithoutRehashing(t *testing.T) {
	h := newHarness(t)
	path := newSampleEPUB(t)
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)

	opened, err := h.books.OpenBook(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Len(t, opened.SpineItems, 3)
	assert.Equal(t, 3, opened.IndexedPageCount)
}

func TestPendingIndexBooksListsAvailablePDFsWithMissingPages(t *testing.T) {
	h := newHarness(t)
	partial, err := h.books.ImportBook(t.Context(), h.writePDF("Partial.pdf", "%PDF-1.7\npartial"))
	require.NoError(t, err)
	_, err = h.books.SaveBookSegments(t.Context(), partial.ID, []BookSegmentInput{pdfSegment(1, "one"), pdfSegment(2, "two")}, 5)
	require.NoError(t, err)

	complete, err := h.books.ImportBook(t.Context(), h.writePDF("Complete.pdf", "%PDF-1.7\ncomplete"))
	require.NoError(t, err)
	_, err = h.books.SaveBookSegments(t.Context(), complete.ID, []BookSegmentInput{pdfSegment(1, "one")}, 1)
	require.NoError(t, err)

	missingPath := h.writePDF("Missing.pdf", "%PDF-1.7\nmissing")
	missing, err := h.books.ImportBook(t.Context(), missingPath)
	require.NoError(t, err)
	_, err = h.books.SaveBookSegments(t.Context(), missing.ID, []BookSegmentInput{pdfSegment(1, "one")}, 3)
	require.NoError(t, err)
	require.NoError(t, os.Remove(missingPath))

	_, err = h.books.ImportBook(t.Context(), h.writePDF("Unopened.pdf", "%PDF-1.7\nunopened"))
	require.NoError(t, err)
	_, err = h.books.ImportBook(t.Context(), newSampleEPUB(t))
	require.NoError(t, err)

	targets, err := h.books.PendingIndexBooks(t.Context())
	require.NoError(t, err)
	require.Len(t, targets, 1)
	assert.Equal(t, partial.ID, targets[0].ID)
	assert.Equal(t, 3, targets[0].NextSegment)
	assert.Equal(t, 5, targets[0].Total)
	assert.Equal(t, partial.URL, targets[0].URL)

	opened, err := h.books.OpenBook(t.Context(), partial.ID)
	require.NoError(t, err)
	assert.Equal(t, 3, opened.NextSegment)
}

func TestLibraryStoresEPUBSectionHeadings(t *testing.T) {
	h := newHarness(t)
	book, err := h.books.ImportBook(t.Context(), newSampleEPUB(t))
	require.NoError(t, err)
	assert.Equal(t, 4, book.NextSegment)

	results, err := h.books.SearchBook(t.Context(), book.ID, "retrieval pipeline")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "Chapter Two", results[0].HeadingPath)
}
