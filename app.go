package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/llm"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	bookRoutePrefix  = "/book/"
	coverRoutePrefix = "/cover/"
	maxCoverBytes    = 4 << 20
)

type BookFile struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Size        int64  `json:"size"`
	InitialPage int    `json:"initialPage"`
	CoverStatus string `json:"coverStatus"`
}

type BookSummary struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	FileName    string `json:"fileName"`
	Size        int64  `json:"size"`
	PageCount   int    `json:"pageCount"`
	LastPage    int    `json:"lastPage"`
	ImportedAt  string `json:"importedAt"`
	LastOpened  string `json:"lastOpenedAt"`
	CoverURL    string `json:"coverUrl"`
	CoverStatus string `json:"coverStatus"`
	Available   bool   `json:"available"`
}

type localResource struct {
	path        string
	contentType string
}

type App struct {
	ctx           context.Context
	gateway       llm.Gateway
	books         *bookServer
	dataDirectory string

	libraryMu  sync.Mutex
	library    *library.Store
	libraryErr error
}

type bookServer struct {
	mu        sync.RWMutex
	resources map[string]localResource
	paths     map[localResource]string
}

func (server *bookServer) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, bookRoutePrefix) ||
			strings.HasPrefix(request.URL.Path, coverRoutePrefix) {
			server.ServeHTTP(response, request)
			return
		}
		next.ServeHTTP(response, request)
	})
}

func NewApp() *App {
	return &App{
		gateway: llm.NewMockGateway(),
		books: &bookServer{
			resources: make(map[string]localResource),
			paths:     make(map[localResource]string),
		},
	}
}

func newAppWithDataDirectory(directory string) *App {
	app := NewApp()
	app.dataDirectory = directory
	return app
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	_ = a.ensureLibrary()
}

func (a *App) shutdown(_ context.Context) {
	a.libraryMu.Lock()
	defer a.libraryMu.Unlock()
	if a.library != nil {
		_ = a.library.Close()
		a.library = nil
	}
}

func (a *App) AppDataDirectory() (string, error) {
	if a.dataDirectory != "" {
		if err := os.MkdirAll(a.dataDirectory, 0o700); err != nil {
			return "", fmt.Errorf("create app data directory: %w", err)
		}
		return a.dataDirectory, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	directory := filepath.Join(base, "Glint")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("create app data directory: %w", err)
	}
	return directory, nil
}

func (a *App) ensureLibrary() error {
	a.libraryMu.Lock()
	defer a.libraryMu.Unlock()
	if a.library != nil || a.libraryErr != nil {
		return a.libraryErr
	}
	directory, err := a.AppDataDirectory()
	if err != nil {
		a.libraryErr = err
		return err
	}
	store, err := library.Open(filepath.Join(directory, "library.sqlite3"))
	if err != nil {
		a.libraryErr = err
		return err
	}
	a.library = store
	return nil
}

func (a *App) libraryStore() (*library.Store, error) {
	if err := a.ensureLibrary(); err != nil {
		return nil, err
	}
	a.libraryMu.Lock()
	defer a.libraryMu.Unlock()
	return a.library, nil
}

func (a *App) ListBooks() ([]BookSummary, error) {
	store, err := a.libraryStore()
	if err != nil {
		return nil, err
	}
	books, err := store.List(context.Background())
	if err != nil {
		return nil, err
	}
	summaries := make([]BookSummary, 0, len(books))
	for _, book := range books {
		summary := BookSummary{
			ID:          book.ID,
			Title:       book.Title,
			FileName:    book.FileName,
			Size:        book.SizeBytes,
			PageCount:   book.PageCount,
			LastPage:    book.LastPage,
			ImportedAt:  book.ImportedAt,
			LastOpened:  book.LastOpenedAt,
			CoverStatus: book.CoverThumbnailStatus,
			Available:   fileExists(book.SourcePath),
		}
		if book.CoverThumbnailStatus == "ready" && fileExists(book.CoverThumbnailPath) {
			summary.CoverURL, err = a.books.register(book.CoverThumbnailPath, "image/png")
			if err != nil {
				return nil, err
			}
		} else if book.CoverThumbnailStatus == "ready" {
			summary.CoverStatus = "pending"
			if err := store.ResetCover(context.Background(), book.ID, time.Now()); err != nil {
				return nil, err
			}
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

func (a *App) OpenPDF() (BookFile, error) {
	if a.ctx == nil {
		return BookFile{}, errors.New("application is not ready")
	}
	path, err := a.choosePDF("技術書 PDF を本棚へ追加")
	if err != nil || path == "" {
		return BookFile{}, err
	}
	return a.selectPDF(path)
}

func (a *App) OpenBook(id string) (BookFile, error) {
	store, err := a.libraryStore()
	if err != nil {
		return BookFile{}, err
	}
	book, err := store.Get(context.Background(), id)
	if err != nil {
		return BookFile{}, err
	}
	if !fileExists(book.SourcePath) {
		return BookFile{}, errors.New("PDFが見つかりません。本棚からファイルを再選択してください。")
	}
	fileHash, size, err := inspectPDF(book.SourcePath)
	if err != nil {
		return BookFile{}, err
	}
	if fileHash != book.FileHash {
		oldCoverPath := book.CoverThumbnailPath
		book, err = store.Relink(context.Background(), id, book.SourcePath, fileHash, size, time.Now())
		if err != nil {
			return BookFile{}, err
		}
		if oldCoverPath != "" {
			_ = os.Remove(oldCoverPath)
		}
	}
	if book.CoverThumbnailStatus == "ready" && !fileExists(book.CoverThumbnailPath) {
		if err := store.ResetCover(context.Background(), id, time.Now()); err != nil {
			return BookFile{}, err
		}
		book.CoverThumbnailPath = ""
		book.CoverThumbnailStatus = "pending"
	}
	if err := store.MarkOpened(context.Background(), id, time.Now()); err != nil {
		return BookFile{}, err
	}
	return a.bookFile(book)
}

func (a *App) RelinkPDF(id string) (BookFile, error) {
	if a.ctx == nil {
		return BookFile{}, errors.New("application is not ready")
	}
	path, err := a.choosePDF("PDF ファイルを再選択")
	if err != nil || path == "" {
		return BookFile{}, err
	}
	fileHash, size, err := inspectPDF(path)
	if err != nil {
		return BookFile{}, err
	}
	store, err := a.libraryStore()
	if err != nil {
		return BookFile{}, err
	}
	oldBook, err := store.Get(context.Background(), id)
	if err != nil {
		return BookFile{}, err
	}
	book, err := store.Relink(context.Background(), id, path, fileHash, size, time.Now())
	if err != nil {
		return BookFile{}, err
	}
	if oldBook.FileHash != fileHash && oldBook.CoverThumbnailPath != "" {
		_ = os.Remove(oldBook.CoverThumbnailPath)
	}
	if err := store.MarkOpened(context.Background(), id, time.Now()); err != nil {
		return BookFile{}, err
	}
	return a.bookFile(book)
}

func (a *App) selectPDF(path string) (BookFile, error) {
	fileHash, size, err := inspectPDF(path)
	if err != nil {
		return BookFile{}, err
	}
	id, err := randomToken()
	if err != nil {
		return BookFile{}, fmt.Errorf("create book id: %w", err)
	}
	store, err := a.libraryStore()
	if err != nil {
		return BookFile{}, err
	}
	book, err := store.Import(context.Background(), id, path, fileHash, size, time.Now())
	if err != nil {
		return BookFile{}, err
	}
	if err := store.MarkOpened(context.Background(), book.ID, time.Now()); err != nil {
		return BookFile{}, err
	}
	return a.bookFile(book)
}

func (a *App) bookFile(book library.Book) (BookFile, error) {
	url, err := a.books.register(book.SourcePath, "application/pdf")
	if err != nil {
		return BookFile{}, err
	}
	coverStatus := book.CoverThumbnailStatus
	if coverStatus == "failed" {
		coverStatus = "pending"
	}
	return BookFile{
		ID:          book.ID,
		Title:       book.Title,
		Name:        book.FileName,
		URL:         url,
		Size:        book.SizeBytes,
		InitialPage: max(1, book.LastPage),
		CoverStatus: coverStatus,
	}, nil
}

func (a *App) SaveReadingPosition(bookID string, pageNumber, pageCount int) error {
	store, err := a.libraryStore()
	if err != nil {
		return err
	}
	return store.SaveReadingPosition(context.Background(), bookID, pageNumber, pageCount, time.Now())
}

func (a *App) SaveBookCover(bookID, dataURL string) error {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		return errors.New("cover must be a PNG data URL")
	}
	encoded := strings.TrimPrefix(dataURL, prefix)
	if base64.StdEncoding.DecodedLen(len(encoded)) > maxCoverBytes {
		return errors.New("cover image is too large")
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("decode cover image: %w", err)
	}
	if len(content) < 8 || string(content[:8]) != "\x89PNG\r\n\x1a\n" {
		return errors.New("cover image is not a PNG")
	}
	store, err := a.libraryStore()
	if err != nil {
		return err
	}
	book, err := store.Get(context.Background(), bookID)
	if err != nil {
		return err
	}
	directory, err := a.AppDataDirectory()
	if err != nil {
		return err
	}
	coverDirectory := filepath.Join(directory, "covers")
	if err := os.MkdirAll(coverDirectory, 0o700); err != nil {
		return fmt.Errorf("create cover directory: %w", err)
	}
	hashPart := book.FileHash
	if len(hashPart) > 12 {
		hashPart = hashPart[:12]
	}
	path := filepath.Join(coverDirectory, book.ID+"-"+hashPart+".png")
	temporaryPath := path + ".tmp"
	if err := os.WriteFile(temporaryPath, content, 0o600); err != nil {
		return fmt.Errorf("write cover image: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("store cover image: %w", err)
	}
	return store.SaveCover(context.Background(), bookID, path, time.Now())
}

func (a *App) MarkBookCoverFailed(bookID string) error {
	store, err := a.libraryStore()
	if err != nil {
		return err
	}
	return store.MarkCoverFailed(context.Background(), bookID, time.Now())
}

func (a *App) StartMockChat(request llm.ChatRequest) error {
	if a.ctx == nil {
		return errors.New("application is not ready")
	}
	stream, err := a.gateway.Complete(a.ctx, request)
	if err != nil {
		return err
	}
	go func() {
		for delta := range stream {
			runtime.EventsEmit(a.ctx, "chat:delta", delta)
		}
	}()
	return nil
}

func (a *App) choosePDF(title string) (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
		Filters: []runtime.FileFilter{
			{DisplayName: "PDF files (*.pdf)", Pattern: "*.pdf"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("open PDF dialog: %w", err)
	}
	return path, nil
}

func inspectPDF(path string) (string, int64, error) {
	if !strings.EqualFold(filepath.Ext(path), ".pdf") {
		return "", 0, errors.New("selected file is not a PDF")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", 0, fmt.Errorf("open selected PDF: %w", err)
	}
	defer file.Close()
	header := make([]byte, 5)
	if _, err := io.ReadFull(file, header); err != nil {
		return "", 0, fmt.Errorf("read selected PDF: %w", err)
	}
	if string(header) != "%PDF-" {
		return "", 0, errors.New("selected file does not contain a PDF header")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", 0, fmt.Errorf("rewind selected PDF: %w", err)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", 0, fmt.Errorf("hash selected PDF: %w", err)
	}
	info, err := file.Stat()
	if err != nil {
		return "", 0, fmt.Errorf("inspect selected PDF: %w", err)
	}
	return hex.EncodeToString(hash.Sum(nil)), info.Size(), nil
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func (server *bookServer) register(path, contentType string) (string, error) {
	resource := localResource{path: path, contentType: contentType}
	server.mu.Lock()
	defer server.mu.Unlock()
	if token, ok := server.paths[resource]; ok {
		return routeFor(contentType, token), nil
	}
	token, err := randomToken()
	if err != nil {
		return "", fmt.Errorf("create local file token: %w", err)
	}
	server.resources[token] = resource
	server.paths[resource] = token
	return routeFor(contentType, token), nil
}

func routeFor(contentType, token string) string {
	if contentType == "application/pdf" {
		return bookRoutePrefix + token
	}
	return coverRoutePrefix + token
}

func (server *bookServer) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := strings.TrimPrefix(request.URL.Path, bookRoutePrefix)
	if token == request.URL.Path {
		token = strings.TrimPrefix(request.URL.Path, coverRoutePrefix)
	}
	if token == "" || token == request.URL.Path || strings.Contains(token, "/") {
		http.NotFound(response, request)
		return
	}
	server.mu.RLock()
	resource, ok := server.resources[token]
	server.mu.RUnlock()
	if !ok {
		http.NotFound(response, request)
		return
	}
	file, err := os.Open(resource.path)
	if err != nil {
		http.Error(response, "local file is no longer available", http.StatusGone)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.Error(response, "unable to inspect local file", http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", resource.contentType)
	if resource.contentType == "application/pdf" {
		response.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", info.Name()))
		response.Header().Set("Cache-Control", "no-store")
	} else {
		response.Header().Set("Cache-Control", "private, max-age=3600")
	}
	http.ServeContent(response, request, info.Name(), info.ModTime(), file)
}

func randomToken() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
