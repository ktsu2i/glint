package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/books"
	"github.com/kaito/glint/internal/chat"
	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/llm"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	wailsassetserver "github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	dataDirectory, err := resolveDataDirectory()
	if err != nil {
		log.Fatal(err)
	}
	store, err := library.Open(filepath.Join(dataDirectory, "library.sqlite3"))
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = store.Close() }()

	assetSrv := assetserver.New()
	booksSvc := books.New(store, assetSrv, dataDirectory)
	chatSvc := chat.New(llm.NewMockGateway())

	err = wails.Run(&options.App{
		Title:     "Glint",
		Width:     1440,
		Height:    900,
		MinWidth:  1024,
		MinHeight: 700,
		AssetServer: &wailsassetserver.Options{
			Assets:     assets,
			Handler:    assetSrv,
			Middleware: assetSrv.Middleware,
		},
		BackgroundColour: &options.RGBA{R: 243, G: 239, B: 231, A: 1},
		LogLevel:         logger.WARNING,
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
		},
		OnStartup: func(ctx context.Context) {
			books.Startup(booksSvc, ctx)
			chat.Startup(chatSvc, ctx)
		},
		Bind: []any{
			booksSvc,
			chatSvc,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

func resolveDataDirectory() (string, error) {
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
