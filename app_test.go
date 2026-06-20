package main

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSelectPDFAndServe(t *testing.T) {
	temporaryDirectory := t.TempDir()
	path := filepath.Join(temporaryDirectory, "sample.pdf")
	content := []byte("%PDF-1.7\nfixture")
	require.NoError(t, os.WriteFile(path, content, 0o600))

	app := newAppWithDataDirectory(filepath.Join(temporaryDirectory, "data"))
	t.Cleanup(func() { app.shutdown(context.Background()) })
	book, err := app.selectPDF(path)
	require.NoError(t, err)
	assert.Equal(t, "sample.pdf", book.Name)
	assert.True(t, strings.HasPrefix(book.URL, bookRoutePrefix))

	request := httptest.NewRequest(http.MethodGet, book.URL, nil)
	response := httptest.NewRecorder()
	app.books.ServeHTTP(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "application/pdf", response.Header().Get("Content-Type"))
	assert.Equal(t, string(content), response.Body.String())

	rangeRequest := httptest.NewRequest(http.MethodGet, book.URL, nil)
	rangeRequest.Header.Set("Range", "bytes=0-4")
	rangeResponse := httptest.NewRecorder()
	app.books.ServeHTTP(rangeResponse, rangeRequest)
	assert.Equal(t, http.StatusPartialContent, rangeResponse.Code)
	assert.Equal(t, "%PDF-", rangeResponse.Body.String())
}

func TestSelectPDFRejectsInvalidHeader(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invalid.pdf")
	require.NoError(t, os.WriteFile(path, []byte("not a pdf"), 0o600))

	_, err := NewApp().selectPDF(path)
	assert.Error(t, err)
}

func TestServeHTTPRejectsUnknownToken(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/book/unknown", nil)
	response := httptest.NewRecorder()
	NewApp().books.ServeHTTP(response, request)

	assert.Equal(t, http.StatusNotFound, response.Code)
}

func TestBookMiddlewareServesPDFBeforeFrontendFallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.pdf")
	content := []byte("%PDF-1.7\nfixture")
	require.NoError(t, os.WriteFile(path, content, 0o600))

	app := newAppWithDataDirectory(filepath.Join(t.TempDir(), "data"))
	t.Cleanup(func() { app.shutdown(context.Background()) })
	book, err := app.selectPDF(path)
	require.NoError(t, err)

	frontend := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/html")
		_, _ = response.Write([]byte("<html>frontend fallback</html>"))
	})
	handler := app.books.middleware(frontend)

	request := httptest.NewRequest(http.MethodGet, book.URL, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "application/pdf", response.Header().Get("Content-Type"))
	assert.Equal(t, string(content), response.Body.String())
}

func TestBookMiddlewareDelegatesNonBookRequests(t *testing.T) {
	frontend := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusTeapot)
	})
	handler := NewApp().books.middleware(frontend)

	request := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	assert.Equal(t, http.StatusTeapot, response.Code)
}

func TestLibraryPersistsBooksCoverAndReadingPosition(t *testing.T) {
	root := t.TempDir()
	dataDirectory := filepath.Join(root, "data")
	path := filepath.Join(root, "Persistent Guide.pdf")
	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nfixture"), 0o600))

	app := newAppWithDataDirectory(dataDirectory)
	book, err := app.selectPDF(path)
	require.NoError(t, err)
	assert.NotEmpty(t, book.ID)
	assert.Equal(t, "Persistent Guide", book.Title)
	assert.Equal(t, 1, book.InitialPage)
	require.NoError(t, app.SaveReadingPosition(book.ID, 3, 8))
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	require.NoError(t, app.SaveBookCover(book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)))
	app.shutdown(context.Background())

	reopened := newAppWithDataDirectory(dataDirectory)
	t.Cleanup(func() { reopened.shutdown(context.Background()) })
	books, err := reopened.ListBooks()
	require.NoError(t, err)
	require.Len(t, books, 1)
	summary := books[0]
	assert.Equal(t, 3, summary.LastPage)
	assert.Equal(t, 8, summary.PageCount)
	assert.Equal(t, "ready", summary.CoverStatus)
	assert.NotEmpty(t, summary.CoverURL)
	assert.True(t, summary.Available)
	opened, err := reopened.OpenBook(summary.ID)
	require.NoError(t, err)
	assert.Equal(t, 3, opened.InitialPage)

	request := httptest.NewRequest(http.MethodGet, summary.CoverURL, nil)
	response := httptest.NewRecorder()
	reopened.books.ServeHTTP(response, request)
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "image/png", response.Header().Get("Content-Type"))
}

func TestLibraryReportsMissingSourceWithoutExposingPath(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "Moved.pdf")
	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nfixture"), 0o600))
	app := newAppWithDataDirectory(filepath.Join(root, "data"))
	t.Cleanup(func() { app.shutdown(context.Background()) })
	book, err := app.selectPDF(path)
	require.NoError(t, err)
	require.NoError(t, os.Remove(path))
	books, err := app.ListBooks()
	require.NoError(t, err)
	require.Len(t, books, 1)
	assert.False(t, books[0].Available)
	_, err = app.OpenBook(book.ID)
	require.Error(t, err)
	assert.NotContains(t, err.Error(), path)
}

func TestSaveBookCoverRejectsInvalidContent(t *testing.T) {
	app := newAppWithDataDirectory(t.TempDir())
	t.Cleanup(func() { app.shutdown(context.Background()) })
	assert.Error(t, app.SaveBookCover("missing", "data:text/plain;base64,SGk="))
}

func TestLibraryRegeneratesCoverWhenCacheOrPDFChanges(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "Changing.pdf")
	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nfirst"), 0o600))
	app := newAppWithDataDirectory(filepath.Join(root, "data"))
	t.Cleanup(func() { app.shutdown(context.Background()) })
	book, err := app.selectPDF(path)
	require.NoError(t, err)
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	require.NoError(t, app.SaveBookCover(book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)))
	covers, err := filepath.Glob(filepath.Join(root, "data", "covers", "*.png"))
	require.NoError(t, err)
	require.Len(t, covers, 1)
	require.NoError(t, os.Remove(covers[0]))
	summaries, err := app.ListBooks()
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	assert.Equal(t, "pending", summaries[0].CoverStatus)
	assert.Empty(t, summaries[0].CoverURL)

	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nsecond version"), 0o600))
	opened, err := app.OpenBook(book.ID)
	require.NoError(t, err)
	assert.Equal(t, "pending", opened.CoverStatus)
	assert.Greater(t, opened.Size, book.Size)
}
