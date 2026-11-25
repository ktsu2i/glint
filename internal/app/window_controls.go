package app

// windowControls shows and hides the macOS traffic-light buttons of the main
// window. Tests replace it with a fake.
type windowControls interface {
	SetVisible(visible bool)
}

// WindowService is bound to the frontend so the reader can hide the window
// controls together with its own toolbars.
type WindowService struct {
	controls windowControls
}

func NewWindowService(controls windowControls) *WindowService {
	return &WindowService{controls: controls}
}

// SetWindowControlsVisible fades the close, minimise and zoom buttons of the
// main window in or out.
func (s *WindowService) SetWindowControlsVisible(visible bool) {
	if s.controls == nil {
		return
	}
	s.controls.SetVisible(visible)
}
