package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	wailsassetserver "github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/books"
	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/settings"
	"github.com/kaito/glint/internal/update"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	dataDirectory, err := resolveDataDirectory()
	if err != nil {
		return err
	}
	store := library.New(filepath.Join(dataDirectory, "library.sqlite3"))
	defer func() { _ = store.Close() }()

	assetSrv := assetserver.New()
	settingsManager := settings.NewManager(store)
	booksSvc := books.New(store, assetSrv, dataDirectory, settingsManager)
	settingsSvc := settings.NewService(settingsManager)

	return wails.Run(&options.App{
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
			if err := store.Connect(); err != nil {
				log.Fatal(err)
			}
			books.Startup(booksSvc, ctx)
			settings.Startup(settingsSvc, ctx)
			update.Start()
		},
		Bind: []any{
			booksSvc,
			settingsSvc,
		},
	})
}

func resolveDataDirectory() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	return filepath.Join(base, "Glint"), nil
}
