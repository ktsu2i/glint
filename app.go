package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/kaito/glint/internal/llm"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const bookRoutePrefix = "/book/"

type BookFile struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Size int64  `json:"size"`
}

type selectedBook struct {
	path  string
	token string
}

type App struct {
	ctx     context.Context
	gateway llm.Gateway
	books   *bookServer
}

type bookServer struct {
	mu   sync.RWMutex
	book selectedBook
}

func (server *bookServer) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, bookRoutePrefix) {
			server.ServeHTTP(response, request)
			return
		}

		next.ServeHTTP(response, request)
	})
}

func NewApp() *App {
	return &App{
		gateway: llm.NewMockGateway(),
		books:   &bookServer{},
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) AppDataDirectory() (string, error) {
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

func (a *App) OpenPDF() (BookFile, error) {
	if a.ctx == nil {
		return BookFile{}, errors.New("application is not ready")
	}

	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "技術書 PDF を開く",
		Filters: []runtime.FileFilter{
			{DisplayName: "PDF files (*.pdf)", Pattern: "*.pdf"},
		},
	})
	if err != nil {
		return BookFile{}, fmt.Errorf("open PDF dialog: %w", err)
	}
	if path == "" {
		return BookFile{}, nil
	}

	return a.selectPDF(path)
}

func (a *App) selectPDF(path string) (BookFile, error) {
	if !strings.EqualFold(filepath.Ext(path), ".pdf") {
		return BookFile{}, errors.New("selected file is not a PDF")
	}

	file, err := os.Open(path)
	if err != nil {
		return BookFile{}, fmt.Errorf("open selected PDF: %w", err)
	}
	defer file.Close()

	header := make([]byte, 5)
	if _, err := io.ReadFull(file, header); err != nil {
		return BookFile{}, fmt.Errorf("read selected PDF: %w", err)
	}
	if string(header) != "%PDF-" {
		return BookFile{}, errors.New("selected file does not contain a PDF header")
	}

	info, err := file.Stat()
	if err != nil {
		return BookFile{}, fmt.Errorf("inspect selected PDF: %w", err)
	}
	token, err := randomToken()
	if err != nil {
		return BookFile{}, fmt.Errorf("create book access token: %w", err)
	}

	a.books.mu.Lock()
	a.books.book = selectedBook{path: path, token: token}
	a.books.mu.Unlock()

	return BookFile{
		Name: filepath.Base(path),
		URL:  bookRoutePrefix + token,
		Size: info.Size(),
	}, nil
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

func (server *bookServer) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := strings.TrimPrefix(request.URL.Path, bookRoutePrefix)
	if token == "" || token == request.URL.Path || strings.Contains(token, "/") {
		http.NotFound(response, request)
		return
	}

	server.mu.RLock()
	book := server.book
	server.mu.RUnlock()
	if book.path == "" || token != book.token {
		http.NotFound(response, request)
		return
	}

	file, err := os.Open(book.path)
	if err != nil {
		http.Error(response, "PDF is no longer available", http.StatusGone)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		http.Error(response, "unable to inspect PDF", http.StatusInternalServerError)
		return
	}

	response.Header().Set("Content-Type", "application/pdf")
	response.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", info.Name()))
	response.Header().Set("Cache-Control", "no-store")
	http.ServeContent(response, request, info.Name(), info.ModTime(), file)
}

func randomToken() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
