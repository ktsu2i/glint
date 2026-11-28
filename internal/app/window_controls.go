package app

type windowControls interface {
	SetVisible(visible bool)
}

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
