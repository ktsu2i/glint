package app

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// settingsWindowURL tells the frontend to render the settings window
// instead of the library and the reader.
const settingsWindowURL = "/#settings"

// SettingsWindow opens the settings window from the application menu and
// keeps at most one of them open.
type SettingsWindow struct {
	app    *application.App
	mu     sync.Mutex
	window *application.WebviewWindow
}

func NewSettingsWindow(desktop *application.App) *SettingsWindow {
	return &SettingsWindow{app: desktop}
}

// Show opens the settings window, or brings the open one to the front.
func (w *SettingsWindow) Show() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.window != nil {
		w.window.Show()
		w.window.Focus()
		return
	}
	window := w.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:                "settings",
		Title:               "Settings",
		Width:               720,
		Height:              520,
		DisableResize:       true,
		MinimiseButtonState: application.ButtonDisabled,
		MaximiseButtonState: application.ButtonDisabled,
		URL:                 settingsWindowURL,
		BackgroundColour:    application.NewRGB(243, 245, 244),
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHiddenInset,
		},
	})
	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		w.mu.Lock()
		defer w.mu.Unlock()
		if w.window == window {
			w.window = nil
		}
	})
	w.window = window
}

// ApplicationMenu builds the macOS menu bar. Settings… opens the settings
// window with Command-comma, as in other Mac apps.
func ApplicationMenu(name string, openSettings func()) *application.Menu {
	menu := application.NewMenu()
	appMenu := menu.AddSubmenu(name)
	appMenu.AddRole(application.About)
	appMenu.AddSeparator()
	appMenu.Add("Settings…").SetAccelerator("CmdOrCtrl+,").OnClick(func(*application.Context) {
		openSettings()
	})
	appMenu.AddSeparator()
	appMenu.AddRole(application.ServicesMenu)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Hide)
	appMenu.AddRole(application.HideOthers)
	appMenu.AddRole(application.UnHide)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Quit)
	menu.AddRole(application.FileMenu)
	menu.AddRole(application.EditMenu)
	menu.AddRole(application.ViewMenu)
	menu.AddRole(application.WindowMenu)
	return menu
}
