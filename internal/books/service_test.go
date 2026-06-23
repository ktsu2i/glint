package books

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/settings"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type harness struct {
	t       *testing.T
	root    string
	dataDir string
	store   *library.Store
	assets  *assetserver.Server
	service *Service
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	store, err := library.Open(filepath.Join(dataDir, "library.sqlite3"))
	require.NoError(t, err)
	assets := assetserver.New()
	service := New(store, assets, dataDir)
	t.Cleanup(func() { _ = store.Close() })
	return &harness{t: t, root: root, dataDir: dataDir, store: store, assets: assets, service: service}
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

	book, err := h.service.selectPDF(path)
	require.NoError(t, err)
	assert.Equal(t, "sample.pdf", book.Name)
	assert.True(t, strings.HasPrefix(book.URL, assetserver.BookRoutePrefix))

	request := httptest.NewRequest(http.MethodGet, book.URL, nil)
	response := httptest.NewRecorder()
	h.assets.ServeHTTP(response, request)
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, content, response.Body.String())
}

func TestServiceLocalizesNativeCopyFromSavedLanguage(t *testing.T) {
	h := newHarness(t)
	manager := settings.NewManager(h.store, nil)
	service := New(h.store, h.assets, h.dataDir, manager)

	assert.Equal(t, "Remove", service.localized("Remove", "削除"))
	_, err := manager.SaveLanguage(context.Background(), settings.SaveLanguageSettingsRequest{
		Language: settings.LanguageJapanese,
	})
	require.NoError(t, err)
	assert.Equal(t, "削除", service.localized("Remove", "削除"))
}

func TestSelectPDFRejectsInvalidHeader(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("invalid.pdf", "not a pdf")
	_, err := h.service.selectPDF(path)
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
	service := New(store, assets, dataDir)

	book, err := service.selectPDF(path)
	require.NoError(t, err)
	assert.NotEmpty(t, book.ID)
	assert.Equal(t, "Persistent Guide", book.Title)
	assert.Equal(t, 1, book.InitialPage)
	require.NoError(t, service.SaveReadingPosition(book.ID, 3, 8))
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	require.NoError(t, service.SaveBookCover(book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)))
	require.NoError(t, store.Close())

	store, err = library.Open(filepath.Join(dataDir, "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	assets = assetserver.New()
	service = New(store, assets, dataDir)

	books, err := service.ListBooks()
	require.NoError(t, err)
	require.Len(t, books, 1)
	summary := books[0]
	assert.Equal(t, 3, summary.LastPage)
	assert.Equal(t, 8, summary.PageCount)
	assert.Equal(t, "ready", summary.CoverStatus)
	assert.NotEmpty(t, summary.CoverURL)
	assert.True(t, summary.Available)
	opened, err := service.OpenBook(summary.ID)
	require.NoError(t, err)
	assert.Equal(t, 3, opened.InitialPage)

	request := httptest.NewRequest(http.MethodGet, summary.CoverURL, nil)
	response := httptest.NewRecorder()
	assets.ServeHTTP(response, request)
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "image/png", response.Header().Get("Content-Type"))
}

func TestLibraryReportsMissingSourceWithoutExposingPath(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Moved.pdf", "%PDF-1.7\nfixture")
	book, err := h.service.selectPDF(path)
	require.NoError(t, err)
	require.NoError(t, os.Remove(path))
	books, err := h.service.ListBooks()
	require.NoError(t, err)
	require.Len(t, books, 1)
	assert.False(t, books[0].Available)
	_, err = h.service.OpenBook(book.ID)
	require.Error(t, err)
	assert.NotContains(t, err.Error(), path)
}

func TestRemoveBookDeletesRecordAndCoverButKeepsSourcePDF(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Removable.pdf", "%PDF-1.7\nfixture")
	book, err := h.service.selectPDF(path)
	require.NoError(t, err)
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	require.NoError(t, h.service.SaveBookCover(book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)))
	covers, err := filepath.Glob(filepath.Join(h.dataDir, "covers", "*.png"))
	require.NoError(t, err)
	require.Len(t, covers, 1)

	removed, err := h.service.RemoveBook(book.ID)
	require.NoError(t, err)
	assert.True(t, removed)

	summaries, err := h.service.ListBooks()
	require.NoError(t, err)
	assert.Empty(t, summaries)
	_, err = os.Stat(covers[0])
	assert.True(t, os.IsNotExist(err))
	_, err = os.Stat(path)
	assert.NoError(t, err, "RemoveBook must not delete the user's source PDF")
	_, err = h.service.RemoveBook(book.ID)
	assert.Error(t, err)
}

func TestRenameBookUpdatesDisplayedTitleWithoutTouchingFileName(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Original Title.pdf", "%PDF-1.7\nfixture")
	book, err := h.service.selectPDF(path)
	require.NoError(t, err)
	assert.Equal(t, "Original Title", book.Title)
	assert.Equal(t, "Original Title.pdf", book.Name)

	summary, err := h.service.RenameBook(book.ID, "  My Custom Name  ")
	require.NoError(t, err)
	assert.Equal(t, "My Custom Name", summary.Title)
	assert.Equal(t, "Original Title.pdf", summary.FileName, "file name must keep tracking the PDF on disk")

	listed, err := h.service.ListBooks()
	require.NoError(t, err)
	require.Len(t, listed, 1)
	assert.Equal(t, "My Custom Name", listed[0].Title)
	assert.Equal(t, "Original Title.pdf", listed[0].FileName)

	opened, err := h.service.OpenBook(book.ID)
	require.NoError(t, err)
	assert.Equal(t, "My Custom Name", opened.Title)

	_, err = h.service.RenameBook(book.ID, "   ")
	assert.Error(t, err)
	_, err = h.service.RenameBook("missing", "anything")
	assert.Error(t, err)
}

func TestSaveBookCoverRejectsInvalidContent(t *testing.T) {
	h := newHarness(t)
	assert.Error(t, h.service.SaveBookCover("missing", "data:text/plain;base64,SGk="))
}

func TestLibraryRegeneratesCoverWhenCacheOrPDFChanges(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Changing.pdf", "%PDF-1.7\nfirst")
	book, err := h.service.selectPDF(path)
	require.NoError(t, err)
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	require.NoError(t, h.service.SaveBookCover(book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)))
	covers, err := filepath.Glob(filepath.Join(h.dataDir, "covers", "*.png"))
	require.NoError(t, err)
	require.Len(t, covers, 1)
	require.NoError(t, os.Remove(covers[0]))
	summaries, err := h.service.ListBooks()
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	assert.Equal(t, "pending", summaries[0].CoverStatus)
	assert.Empty(t, summaries[0].CoverURL)

	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nsecond version"), 0o600))
	opened, err := h.service.OpenBook(book.ID)
	require.NoError(t, err)
	assert.Equal(t, "pending", opened.CoverStatus)
	assert.Greater(t, opened.Size, book.Size)
}

func TestServiceIndexesAndSearchesBookPages(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Searchable.pdf", "%PDF-1.7\nfixture")
	book, err := h.service.selectPDF(path)
	require.NoError(t, err)
	assert.Zero(t, book.IndexedPageCount)

	count, err := h.service.SaveBookPages(book.ID, []BookPageInput{
		{PageNumber: 1, Text: "Evidence from the first page.", Width: 612, Height: 792},
		{PageNumber: 2, Text: "A retrieval pipeline returns evidence.", Width: 612, Height: 792},
	}, 2)
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	results, err := h.service.SearchBook(book.ID, "retrieval evidence")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 2, results[0].PageNumber)

	opened, err := h.service.OpenBook(book.ID)
	require.NoError(t, err)
	assert.Equal(t, 2, opened.IndexedPageCount)
	_, err = h.service.SearchBook(book.ID, "   ")
	assert.Error(t, err)
}

func TestServiceSearchesLibraryAcrossBooks(t *testing.T) {
	h := newHarness(t)
	guidePath := h.writePDF("Guide.pdf", "%PDF-1.7\nguide")
	cookbookPath := h.writePDF("Cookbook.pdf", "%PDF-1.7\ncookbook")
	notesPath := h.writePDF("Notes.pdf", "%PDF-1.7\nnotes")

	guide, err := h.service.selectPDF(guidePath)
	require.NoError(t, err)
	cookbook, err := h.service.selectPDF(cookbookPath)
	require.NoError(t, err)
	notes, err := h.service.selectPDF(notesPath)
	require.NoError(t, err)

	_, err = h.service.SaveBookPages(guide.ID, []BookPageInput{
		{PageNumber: 1, Text: "Context builder filters what gets sent.", Width: 612, Height: 792},
		{PageNumber: 2, Text: "Mention of context builder once more.", Width: 612, Height: 792},
	}, 2)
	require.NoError(t, err)
	_, err = h.service.SaveBookPages(cookbook.ID, []BookPageInput{
		{PageNumber: 1, Text: "Context builder. Context builder. Context builder.", Width: 612, Height: 792},
	}, 1)
	require.NoError(t, err)
	_, err = h.service.SaveBookPages(notes.ID, []BookPageInput{
		{PageNumber: 1, Text: "Unrelated lexical evidence about retrieval.", Width: 612, Height: 792},
	}, 1)
	require.NoError(t, err)

	hits, err := h.service.SearchLibrary("context builder")
	require.NoError(t, err)
	require.Len(t, hits, 2, "only matching books should be returned")
	assert.Equal(t, cookbook.ID, hits[0].Book.ID)
	assert.NotEmpty(t, hits[0].Book.Title)
	assert.GreaterOrEqual(t, hits[0].TotalMatches, 3)
	assert.NotEmpty(t, hits[0].Pages)
	assert.Equal(t, guide.ID, hits[1].Book.ID)
	assert.Len(t, hits[1].Pages, 2)

	_, err = h.service.SearchLibrary("   ")
	assert.Error(t, err)
	empty, err := h.service.SearchLibrary("nonexistent_term")
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestServicePersistsPageBookmarks(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Bookmarks.pdf", "%PDF-1.7\nfixture")
	book, err := h.service.selectPDF(path)
	require.NoError(t, err)

	saved, err := h.service.AddBookmark(book.ID, 5, 12)
	require.NoError(t, err)
	assert.Equal(t, 5, saved.PageNumber)
	assert.NotEmpty(t, saved.CreatedAt)
	_, err = h.service.AddBookmark(book.ID, 13, 12)
	assert.Error(t, err)

	bookmarks, err := h.service.ListBookmarks(book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1)
	assert.Equal(t, 5, bookmarks[0].PageNumber)
	require.NoError(t, h.service.RemoveBookmark(book.ID, 5))
	bookmarks, err = h.service.ListBookmarks(book.ID)
	require.NoError(t, err)
	assert.Empty(t, bookmarks)
}
