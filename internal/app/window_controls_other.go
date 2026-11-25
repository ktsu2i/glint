//go:build !darwin

package app

import "github.com/wailsapp/wails/v3/pkg/application"

// NativeWindowControls switches the window buttons on and off where AppKit
// is not available to fade them.
type NativeWindowControls struct {
	window *application.WebviewWindow
}

func NewNativeWindowControls(window *application.WebviewWindow) *NativeWindowControls {
	return &NativeWindowControls{window: window}
}

func (c *NativeWindowControls) SetVisible(visible bool) {
	if c.window == nil {
		return
	}
	state := application.ButtonHidden
	if visible {
		state = application.ButtonEnabled
	}
	c.window.SetCloseButtonState(state)
	c.window.SetMinimiseButtonState(state)
	c.window.SetMaximiseButtonState(state)
}
