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
)

func TestSelectPDFAndServe(t *testing.T) {
	temporaryDirectory := t.TempDir()
	path := filepath.Join(temporaryDirectory, "sample.pdf")
	content := []byte("%PDF-1.7\nfixture")
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}

	app := newAppWithDataDirectory(filepath.Join(temporaryDirectory, "data"))
	t.Cleanup(func() { app.shutdown(context.Background()) })
	book, err := app.selectPDF(path)
	if err != nil {
		t.Fatalf("selectPDF returned an error: %v", err)
	}
	if book.Name != "sample.pdf" || !strings.HasPrefix(book.URL, bookRoutePrefix) {
		t.Fatalf("unexpected book metadata: %#v", book)
	}

	request := httptest.NewRequest(http.MethodGet, book.URL, nil)
	response := httptest.NewRecorder()
	app.books.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	if response.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("unexpected content type: %s", response.Header().Get("Content-Type"))
	}
	if response.Body.String() != string(content) {
		t.Fatalf("unexpected response body: %q", response.Body.String())
	}

	rangeRequest := httptest.NewRequest(http.MethodGet, book.URL, nil)
	rangeRequest.Header.Set("Range", "bytes=0-4")
	rangeResponse := httptest.NewRecorder()
	app.books.ServeHTTP(rangeResponse, rangeRequest)
	if rangeResponse.Code != http.StatusPartialContent {
		t.Fatalf("expected range status 206, got %d", rangeResponse.Code)
	}
	if rangeResponse.Body.String() != "%PDF-" {
		t.Fatalf("unexpected range body: %q", rangeResponse.Body.String())
	}
}

func TestSelectPDFRejectsInvalidHeader(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invalid.pdf")
	if err := os.WriteFile(path, []byte("not a pdf"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := NewApp().selectPDF(path); err == nil {
		t.Fatal("expected invalid PDF to be rejected")
	}
}

func TestServeHTTPRejectsUnknownToken(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/book/unknown", nil)
	response := httptest.NewRecorder()
	NewApp().books.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", response.Code)
	}
}

func TestBookMiddlewareServesPDFBeforeFrontendFallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.pdf")
	content := []byte("%PDF-1.7\nfixture")
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}

	app := newAppWithDataDirectory(filepath.Join(t.TempDir(), "data"))
	t.Cleanup(func() { app.shutdown(context.Background()) })
	book, err := app.selectPDF(path)
	if err != nil {
		t.Fatalf("selectPDF returned an error: %v", err)
	}

	frontend := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/html")
		_, _ = response.Write([]byte("<html>frontend fallback</html>"))
	})
	handler := app.books.middleware(frontend)

	request := httptest.NewRequest(http.MethodGet, book.URL, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	if response.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("unexpected content type: %s", response.Header().Get("Content-Type"))
	}
	if response.Body.String() != string(content) {
		t.Fatalf("expected PDF body, got %q", response.Body.String())
	}
}

func TestBookMiddlewareDelegatesNonBookRequests(t *testing.T) {
	frontend := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusTeapot)
	})
	handler := NewApp().books.middleware(frontend)

	request := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusTeapot {
		t.Fatalf("expected frontend status, got %d", response.Code)
	}
}

func TestLibraryPersistsBooksCoverAndReadingPosition(t *testing.T) {
	root := t.TempDir()
	dataDirectory := filepath.Join(root, "data")
	path := filepath.Join(root, "Persistent Guide.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.7\nfixture"), 0o600); err != nil {
		t.Fatal(err)
	}

	app := newAppWithDataDirectory(dataDirectory)
	book, err := app.selectPDF(path)
	if err != nil {
		t.Fatal(err)
	}
	if book.ID == "" || book.Title != "Persistent Guide" || book.InitialPage != 1 {
		t.Fatalf("unexpected book: %#v", book)
	}
	if err := app.SaveReadingPosition(book.ID, 3, 8); err != nil {
		t.Fatal(err)
	}
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	if err := app.SaveBookCover(book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)); err != nil {
		t.Fatal(err)
	}
	app.shutdown(context.Background())

	reopened := newAppWithDataDirectory(dataDirectory)
	t.Cleanup(func() { reopened.shutdown(context.Background()) })
	books, err := reopened.ListBooks()
	if err != nil {
		t.Fatal(err)
	}
	if len(books) != 1 {
		t.Fatalf("expected one book, got %#v", books)
	}
	summary := books[0]
	if summary.LastPage != 3 || summary.PageCount != 8 || summary.CoverStatus != "ready" || summary.CoverURL == "" || !summary.Available {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	opened, err := reopened.OpenBook(summary.ID)
	if err != nil {
		t.Fatal(err)
	}
	if opened.InitialPage != 3 {
		t.Fatalf("expected page 3, got %#v", opened)
	}

	request := httptest.NewRequest(http.MethodGet, summary.CoverURL, nil)
	response := httptest.NewRecorder()
	reopened.books.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("unexpected cover response: %d %s", response.Code, response.Header().Get("Content-Type"))
	}
}

func TestLibraryReportsMissingSourceWithoutExposingPath(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "Moved.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.7\nfixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	app := newAppWithDataDirectory(filepath.Join(root, "data"))
	t.Cleanup(func() { app.shutdown(context.Background()) })
	book, err := app.selectPDF(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	books, err := app.ListBooks()
	if err != nil {
		t.Fatal(err)
	}
	if len(books) != 1 || books[0].Available {
		t.Fatalf("expected unavailable book, got %#v", books)
	}
	if _, err := app.OpenBook(book.ID); err == nil || strings.Contains(err.Error(), path) {
		t.Fatalf("expected path-safe missing file error, got %v", err)
	}
}

func TestSaveBookCoverRejectsInvalidContent(t *testing.T) {
	app := newAppWithDataDirectory(t.TempDir())
	t.Cleanup(func() { app.shutdown(context.Background()) })
	if err := app.SaveBookCover("missing", "data:text/plain;base64,SGk="); err == nil {
		t.Fatal("expected invalid cover type to fail")
	}
}

func TestLibraryRegeneratesCoverWhenCacheOrPDFChanges(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "Changing.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.7\nfirst"), 0o600); err != nil {
		t.Fatal(err)
	}
	app := newAppWithDataDirectory(filepath.Join(root, "data"))
	t.Cleanup(func() { app.shutdown(context.Background()) })
	book, err := app.selectPDF(path)
	if err != nil {
		t.Fatal(err)
	}
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)
	if err := app.SaveBookCover(book.ID, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png)); err != nil {
		t.Fatal(err)
	}
	covers, err := filepath.Glob(filepath.Join(root, "data", "covers", "*.png"))
	if err != nil || len(covers) != 1 {
		t.Fatalf("expected cached cover, got %#v, %v", covers, err)
	}
	if err := os.Remove(covers[0]); err != nil {
		t.Fatal(err)
	}
	summaries, err := app.ListBooks()
	if err != nil {
		t.Fatal(err)
	}
	if summaries[0].CoverStatus != "pending" || summaries[0].CoverURL != "" {
		t.Fatalf("expected missing cache to be regenerated: %#v", summaries[0])
	}

	if err := os.WriteFile(path, []byte("%PDF-1.7\nsecond version"), 0o600); err != nil {
		t.Fatal(err)
	}
	opened, err := app.OpenBook(book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if opened.CoverStatus != "pending" || opened.Size <= book.Size {
		t.Fatalf("expected changed PDF to invalidate cover: %#v", opened)
	}
}
