package main

import (
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

	app := NewApp()
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

	app := NewApp()
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
