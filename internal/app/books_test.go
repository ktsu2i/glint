package app

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/books"
	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/settings"
)

var pngDataURL = "data:image/png;base64," + base64.StdEncoding.EncodeToString(
	append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...),
)

type fakeDialogs struct {
	path       string
	confirmed  bool
	confirmErr error
	asked      []confirmation
	titles     []string
}

func (f *fakeDialogs) chooseBookFile(_ context.Context, title string) (string, error) {
	f.titles = append(f.titles, title)
	return f.path, nil
}

func (f *fakeDialogs) confirm(_ context.Context, request confirmation) (bool, error) {
	f.asked = append(f.asked, request)
	return f.confirmed, f.confirmErr
}

type harness struct {
	t        *testing.T
	root     string
	assets   *assetserver.Server
	settings *settings.Manager
	dialogs  *fakeDialogs
	service  *BooksService
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	store, err := library.Open(filepath.Join(dataDir, "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	assets := assetserver.New()
	manager := settings.NewManager(store)
	service := NewBooksService(books.New(store, dataDir), assets, manager, nil)
	dialogs := &fakeDialogs{}
	service.dialogs = dialogs
	require.NoError(t, service.ServiceStartup(t.Context(), application.ServiceOptions{}))
	return &harness{t: t, root: root, assets: assets, settings: manager, dialogs: dialogs, service: service}
}

func (h *harness) writePDF(name, body string) string {
	path := filepath.Join(h.root, name)
	require.NoError(h.t, os.WriteFile(path, []byte(body), 0o600))
	return path
}

func (h *harness) importPDF(name string) BookFile {
	h.t.Helper()
	h.dialogs.path = h.writePDF(name, "%PDF-1.7\nfixture")
	book, err := h.service.OpenBookFile()
	require.NoError(h.t, err)
	return book
}

func (h *harness) useJapanese() {
	h.t.Helper()
	_, err := h.settings.SaveLanguage(h.t.Context(), settings.SaveLanguageSettingsRequest{
		Language: settings.LanguageJapanese,
	})
	require.NoError(h.t, err)
}

func (h *harness) get(url string) *httptest.ResponseRecorder {
	request := httptest.NewRequestWithContext(h.t.Context(), http.MethodGet, url, nil)
	response := httptest.NewRecorder()
	h.assets.ServeHTTP(response, request)
	return response
}

func TestOpenBookFileRegistersAssetAndReturnsBookFile(t *testing.T) {
	h := newHarness(t)
	content := "%PDF-1.7\nfixture"

	book := h.importPDF("sample.pdf")
	assert.Equal(t, "sample", book.Title)
	assert.Equal(t, "sample.pdf", book.Name)
	assert.Equal(t, 1, book.InitialPage)
	assert.True(t, strings.HasPrefix(book.URL, assetserver.BookRoutePrefix))
	assert.Equal(t, []string{"Add a technical book to the library"}, h.dialogs.titles)

	response := h.get(book.URL)
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, content, response.Body.String())
}

func TestOpenBookFileDoesNothingWhenDialogIsCancelled(t *testing.T) {
	h := newHarness(t)
	book, err := h.service.OpenBookFile()
	require.NoError(t, err)
	assert.Empty(t, book.ID)
}

func TestDialogMethodsRequireStartup(t *testing.T) {
	service := NewBooksService(nil, nil, nil, nil)
	_, err := service.OpenBookFile()
	assert.ErrorIs(t, err, errNotReady)
	_, err = service.RelinkBook("id")
	assert.ErrorIs(t, err, errNotReady)
	_, err = service.RemoveBook("id")
	assert.ErrorIs(t, err, errNotReady)
}

func TestListBooksServesCoverAndKeepsReadingPosition(t *testing.T) {
	h := newHarness(t)
	book := h.importPDF("Guide.pdf")
	require.NoError(t, h.service.SaveReadingPosition(book.ID, 3, 8, ""))
	require.NoError(t, h.service.SaveBookCover(book.ID, pngDataURL))

	summaries, err := h.service.ListBooks()
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	assert.Equal(t, 3, summaries[0].LastPage)
	assert.Equal(t, "ready", summaries[0].CoverStatus)
	assert.True(t, summaries[0].Available)
	response := h.get(summaries[0].CoverURL)
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "image/png", response.Header().Get("Content-Type"))

	opened, err := h.service.OpenBook(book.ID)
	require.NoError(t, err)
	assert.Equal(t, 3, opened.InitialPage)
}

func TestSaveBookCoverRejectsInvalidDataURL(t *testing.T) {
	h := newHarness(t)
	book := h.importPDF("Cover.pdf")
	assert.ErrorContains(t, h.service.SaveBookCover(book.ID, "data:text/plain;base64,SGk="), "PNG data URL")
	assert.ErrorContains(t, h.service.SaveBookCover(book.ID, "data:image/png;base64,!!!"), "decode")
	notPNG := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("plain"))
	assert.ErrorIs(t, h.service.SaveBookCover(book.ID, notPNG), books.ErrInvalidCover)
}

func TestOpenBookReportsMissingSourceWithoutExposingPath(t *testing.T) {
	h := newHarness(t)
	book := h.importPDF("Moved.pdf")
	require.NoError(t, os.Remove(h.dialogs.path))

	_, err := h.service.OpenBook(book.ID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "could not be found")
	assert.NotContains(t, err.Error(), h.dialogs.path)

	h.useJapanese()
	_, err = h.service.OpenBook(book.ID)
	assert.EqualError(t, err, "本のファイルが見つかりません。本棚からファイルを再選択してください。")
}

func TestRemoveBookAsksForConfirmationInSavedLanguage(t *testing.T) {
	h := newHarness(t)
	book := h.importPDF("Removable.pdf")
	h.useJapanese()

	removed, err := h.service.RemoveBook(book.ID)
	require.NoError(t, err)
	assert.False(t, removed, "cancelling the dialog keeps the book")
	require.Len(t, h.dialogs.asked, 1)
	assert.Equal(t, "削除", h.dialogs.asked[0].accept)
	assert.Contains(t, h.dialogs.asked[0].message, "「Removable」")

	h.dialogs.confirmed = true
	removed, err = h.service.RemoveBook(book.ID)
	require.NoError(t, err)
	assert.True(t, removed)
	summaries, err := h.service.ListBooks()
	require.NoError(t, err)
	assert.Empty(t, summaries)
	assert.FileExists(t, h.dialogs.path)
}

func TestRemoveBookReportsDialogFailure(t *testing.T) {
	h := newHarness(t)
	book := h.importPDF("Removable.pdf")
	h.dialogs.confirmErr = errors.New("boom")

	removed, err := h.service.RemoveBook(book.ID)
	assert.False(t, removed)
	assert.ErrorContains(t, err, "confirm book removal")
}

func TestRelinkBookUsesChosenFile(t *testing.T) {
	h := newHarness(t)
	book := h.importPDF("Relink.pdf")

	h.dialogs.path = h.writePDF("Relinked.pdf", "%PDF-1.7\nfixture")
	relinked, err := h.service.RelinkBook(book.ID)
	require.NoError(t, err)
	assert.Equal(t, "Relinked.pdf", relinked.Name)
	assert.Equal(t, "Choose the book file again", h.dialogs.titles[len(h.dialogs.titles)-1])
}

func TestBookErrorsAreLocalized(t *testing.T) {
	h := newHarness(t)
	book := h.importPDF("Errors.pdf")

	_, err := h.service.RenameBook(book.ID, "   ")
	assert.EqualError(t, err, "Book names must be between 1 and 200 characters.")
	_, err = h.service.AddBookmark(book.ID, BookmarkInput{PageNumber: 13, PageCount: 12})
	assert.EqualError(t, err, "The bookmark is outside this book.")
	_, err = h.service.SearchBook(book.ID, "   ")
	assert.EqualError(t, err, "Search terms must be between 1 and 200 characters.")
	_, err = h.service.AddHighlight(book.ID, HighlightInput{PageNumber: 1, PageCount: 2, Color: "yellow", Text: "text"})
	assert.EqualError(t, err, "The highlight could not be saved. Select up to 10,000 characters.")

	h.useJapanese()
	_, err = h.service.SearchLibrary("   ")
	assert.EqualError(t, err, "検索語は1〜200文字で入力してください。")
	h.dialogs.path = h.writePDF("notes.txt", "plain")
	_, err = h.service.OpenBookFile()
	assert.EqualError(t, err, "PDF または EPUB のみ取り込めます。")
}

func TestSearchAndIndexReturnDTOs(t *testing.T) {
	h := newHarness(t)
	book := h.importPDF("Searchable.pdf")

	count, err := h.service.SaveBookSegments(book.ID, []BookSegmentInput{
		{Ordinal: 1, Location: library.PageLocation(1), Text: "Evidence from the first page."},
		{Ordinal: 2, Location: library.PageLocation(2), Text: "A retrieval pipeline returns evidence."},
	}, 3)
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	results, err := h.service.SearchBook(book.ID, "retrieval evidence")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 2, results[0].PageNumber)
	assert.Equal(t, "page:2", results[0].Location)

	hits, err := h.service.SearchLibrary("retrieval")
	require.NoError(t, err)
	require.Len(t, hits, 1)
	assert.Equal(t, book.ID, hits[0].Book.ID)
	assert.Equal(t, "Searchable", hits[0].Book.Title)

	targets, err := h.service.PendingIndexBooks()
	require.NoError(t, err)
	require.Len(t, targets, 1)
	assert.Equal(t, book.URL, targets[0].URL)
	assert.Equal(t, 3, targets[0].NextSegment)
}

func TestHighlightsRoundTripAsDTOs(t *testing.T) {
	h := newHarness(t)
	book := h.importPDF("Highlights.pdf")
	rects := []HighlightRect{{X: 0.12, Y: 0.3, Width: 0.5, Height: 0.025}}

	saved, err := h.service.AddHighlight(book.ID, HighlightInput{
		PageNumber: 2, PageCount: 5, Color: "pink", Text: "an idea worth keeping", Rects: rects,
	})
	require.NoError(t, err)
	assert.Equal(t, 2, saved.PageNumber)
	assert.Equal(t, "pink", saved.Color)
	assert.Equal(t, rects, saved.Rects)

	listed, err := h.service.ListHighlights(book.ID)
	require.NoError(t, err)
	assert.Equal(t, []BookHighlight{saved}, listed)

	changed, err := h.service.ChangeHighlightColor(book.ID, saved.ID, "green")
	require.NoError(t, err)
	assert.Equal(t, "green", changed.Color)
	assert.Equal(t, rects, changed.Rects)

	require.NoError(t, h.service.RemoveHighlight(book.ID, saved.ID))
	_, err = h.service.ChangeHighlightColor(book.ID, saved.ID, "green")
	assert.EqualError(t, err, "The highlight no longer exists.")
	listed, err = h.service.ListHighlights(book.ID)
	require.NoError(t, err)
	assert.Empty(t, listed)

	h.useJapanese()
	_, err = h.service.AddHighlight(book.ID, HighlightInput{PageNumber: 1, PageCount: 5, Color: "pink", Text: "x"})
	assert.EqualError(t, err, "ハイライトを保存できませんでした。10,000文字以内で選択してください。")
}

func TestEPUBHighlightsRoundTripAsDTOs(t *testing.T) {
	h := newHarness(t)
	h.dialogs.path = writeTestEPUB(t, h.root)
	book, err := h.service.OpenBookFile()
	require.NoError(t, err)
	require.Equal(t, "epub", book.Format)

	const cfi = "epubcfi(/6/2!/4/10,/1:0,/1:9)"
	saved, err := h.service.AddHighlight(book.ID, HighlightInput{
		PageNumber: 1, PageCount: 1, Color: "yellow", Text: "Paragraph", Rects: []HighlightRect{}, CFI: cfi,
	})
	require.NoError(t, err)
	assert.Equal(t, cfi, saved.CFI)
	assert.Empty(t, saved.Rects)

	listed, err := h.service.ListHighlights(book.ID)
	require.NoError(t, err)
	assert.Equal(t, []BookHighlight{saved}, listed)
}

func TestOpenBookRestoresEPUBPlaceAndBindingDirection(t *testing.T) {
	h := newHarness(t)
	h.dialogs.path = writeTestEPUB(t, h.root)
	book, err := h.service.OpenBookFile()
	require.NoError(t, err)
	assert.Empty(t, book.InitialCFI)
	assert.Equal(t, "ltr", book.BindingDirection)

	const cfi = "epubcfi(/6/2!/4/10/1:4)"
	require.NoError(t, h.service.SaveReadingPosition(book.ID, 1, 1, cfi))
	require.NoError(t, h.service.SaveBindingDirection(book.ID, "rtl"))

	opened, err := h.service.OpenBook(book.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, opened.InitialPage)
	assert.Equal(t, cfi, opened.InitialCFI)
	assert.Equal(t, "rtl", opened.BindingDirection)

	assert.EqualError(t, h.service.SaveBindingDirection(book.ID, "up"), "The binding direction must be left or right.")
	h.useJapanese()
	assert.EqualError(t, h.service.SaveBindingDirection(book.ID, "up"), "綴じ方向は左綴じか右綴じを指定してください。")
}

func writeTestEPUB(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "Reflowable.epub")
	output, err := os.Create(path)
	require.NoError(t, err)
	writer := zip.NewWriter(output)
	for name, content := range map[string]string{
		"mimetype": "application/epub+zip",
		"META-INF/container.xml": `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
			`<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OEBPS/content.opf": `<package xmlns="http://www.idpf.org/2007/opf"><metadata/>` +
			`<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>` +
			`<spine><itemref idref="c1"/></spine></package>`,
		"OEBPS/c1.xhtml": `<html><body><h1>One</h1><p>Paragraph text.</p></body></html>`,
	} {
		entry, err := writer.Create(name)
		require.NoError(t, err)
		_, err = entry.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	require.NoError(t, output.Close())
	return path
}
