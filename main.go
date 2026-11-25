package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/kaito/glint/internal/app"
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
	if err := store.Connect(); err != nil {
		return err
	}

	assetSrv := assetserver.New()
	settingsManager := settings.NewManager(store)
	mainWindowState := app.NewMainWindowState(settingsManager)
	desktop := application.New(application.Options{
		Name: "Glint",
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: assetSrv.Middleware,
		},
		LogLevel: slog.LevelWarn,
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		OnShutdown: func() {
			mainWindowState.Save(context.Background())
			_ = store.Close()
		},
	})
	booksSvc := app.NewBooksService(books.New(store, dataDirectory), assetSrv, settingsManager, desktop)
	settingsSvc := app.NewSettingsService(settingsManager, desktop.Event)
	settingsWindow := app.NewSettingsWindow(desktop)
	desktop.Menu.SetApplicationMenu(app.ApplicationMenu("Glint", settingsWindow.Show))
	desktop.RegisterService(application.NewService(booksSvc))
	desktop.RegisterService(application.NewService(settingsSvc))
	desktop.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
		update.Start()
	})
	mainWindow := desktop.Window.NewWithOptions(mainWindowState.Options(context.Background(), application.WebviewWindowOptions{
		Title:            "Glint",
		Width:            1440,
		Height:           900,
		MinWidth:         1024,
		MinHeight:        700,
		URL:              "/",
		BackgroundColour: application.NewRGB(221, 230, 227),
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHiddenInsetUnified,
		},
	}))
	mainWindowState.Track(mainWindow, desktop.Screen.GetAll)
	desktop.RegisterService(application.NewService(app.NewWindowService(app.NewNativeWindowControls(mainWindow))))
	return desktop.Run()
}

func resolveDataDirectory() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	return filepath.Join(base, "Glint"), nil
}
