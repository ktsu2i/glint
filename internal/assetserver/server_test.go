package assetserver

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegisterAndServePDF(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.pdf")
	content := []byte("%PDF-1.7\nfixture")
	require.NoError(t, os.WriteFile(path, content, 0o600))

	server := New()
	url, err := server.Register(path, "application/pdf")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(url, BookRoutePrefix))

	request := httptest.NewRequest(http.MethodGet, url, nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "application/pdf", response.Header().Get("Content-Type"))
	assert.Equal(t, string(content), response.Body.String())

	rangeRequest := httptest.NewRequest(http.MethodGet, url, nil)
	rangeRequest.Header.Set("Range", "bytes=0-4")
	rangeResponse := httptest.NewRecorder()
	server.ServeHTTP(rangeResponse, rangeRequest)
	assert.Equal(t, http.StatusPartialContent, rangeResponse.Code)
	assert.Equal(t, "%PDF-", rangeResponse.Body.String())
}

func TestServeHTTPRejectsUnknownToken(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/book/unknown", nil)
	response := httptest.NewRecorder()
	New().ServeHTTP(response, request)
	assert.Equal(t, http.StatusNotFound, response.Code)
}

func TestMiddlewareServesRegisteredFileBeforeFallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.pdf")
	content := []byte("%PDF-1.7\nfixture")
	require.NoError(t, os.WriteFile(path, content, 0o600))

	server := New()
	url, err := server.Register(path, "application/pdf")
	require.NoError(t, err)

	frontend := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/html")
		_, _ = response.Write([]byte("<html>frontend fallback</html>"))
	})
	handler := server.Middleware(frontend)

	request := httptest.NewRequest(http.MethodGet, url, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "application/pdf", response.Header().Get("Content-Type"))
	assert.Equal(t, string(content), response.Body.String())
}

func TestMiddlewareDelegatesNonAssetRequests(t *testing.T) {
	frontend := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusTeapot)
	})
	handler := New().Middleware(frontend)

	request := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	assert.Equal(t, http.StatusTeapot, response.Code)
}
