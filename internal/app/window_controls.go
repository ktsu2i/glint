package app

import "github.com/wailsapp/wails/v3/pkg/application"

// windowButtons is the part of the main window that shows and hides the
// macOS traffic-light buttons. Tests replace it with a fake.
type windowButtons interface {
	SetCloseButtonState(state application.ButtonState) application.Window
	SetMinimiseButtonState(state application.ButtonState) application.Window
	SetMaximiseButtonState(state application.ButtonState) application.Window
}

// WindowService is bound to the frontend so the reader can hide the window
// controls together with its own toolbars.
type WindowService struct {
	window windowButtons
}

func NewWindowService(window windowButtons) *WindowService {
	return &WindowService{window: window}
}

// SetWindowControlsVisible shows or hides the close, minimise and zoom buttons
// of the main window.
func (s *WindowService) SetWindowControlsVisible(visible bool) {
	if s.window == nil {
		return
	}
	state := application.ButtonHidden
	if visible {
		state = application.ButtonEnabled
	}
	s.window.SetCloseButtonState(state)
	s.window.SetMinimiseButtonState(state)
	s.window.SetMaximiseButtonState(state)
}
