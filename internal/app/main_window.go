package app

import (
	"context"
	"log/slog"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/ktsu2i/glint/internal/settings"
)

// mainWindowStore keeps the size, position and state of the main window
// between launches. Tests replace it with a fake.
type mainWindowStore interface {
	GetMainWindowState(ctx context.Context) (settings.WindowState, bool, error)
	SaveMainWindowState(ctx context.Context, state settings.WindowState) error
}

// MainWindowState opens the main window where it was when Glint quit, the
// way Mac apps do, and remembers where it is when Glint quits again.
type MainWindowState struct {
	store mainWindowStore

	// saved is the state read at launch. It is kept apart from state, which
	// already follows the window while it opens.
	saved    settings.WindowState
	hasSaved bool

	mu       sync.Mutex
	state    settings.WindowState
	hasState bool
	window   *application.WebviewWindow
	restore  sync.Once
}

func NewMainWindowState(store mainWindowStore) *MainWindowState {
	return &MainWindowState{store: store}
}

// Options sets the size and position the main window opens with. Without a
// saved state, or with a broken one, the defaults in options are kept.
func (s *MainWindowState) Options(ctx context.Context, options application.WebviewWindowOptions) application.WebviewWindowOptions {
	state, ok, err := s.store.GetMainWindowState(ctx)
	if err != nil {
		slog.Warn("ignore saved main window state", "error", err)
		return options
	}
	if !ok {
		return options
	}
	s.saved, s.hasSaved = state, true
	s.mu.Lock()
	s.state, s.hasState = state, true
	s.mu.Unlock()
	return applyWindowBounds(options, state.Bounds)
}

func applyWindowBounds(options application.WebviewWindowOptions, bounds settings.WindowBounds) application.WebviewWindowOptions {
	options.InitialPosition = application.WindowXY
	options.X, options.Y = bounds.X, bounds.Y
	options.Width = max(bounds.Width, options.MinWidth)
	options.Height = max(bounds.Height, options.MinHeight)
	return options
}

// Track follows the main window. Once the window is up, it is moved back on
// screen if its display is gone and maximised or put in full screen as it
// was. Moves and resizes are recorded so that a maximised or full screen
// window still remembers its normal frame.
func (s *MainWindowState) Track(window *application.WebviewWindow, screens func() []*application.Screen) {
	s.mu.Lock()
	s.window = window
	s.mu.Unlock()
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		s.restore.Do(func() { s.restoreOnScreen(window, screens()) })
	})
	record := func(*application.WindowEvent) { s.capture() }
	window.OnWindowEvent(events.Common.WindowDidMove, record)
	window.OnWindowEvent(events.Common.WindowDidResize, record)
	window.OnWindowEvent(events.Common.WindowClosing, record)
}

func (s *MainWindowState) restoreOnScreen(window *application.WebviewWindow, screens []*application.Screen) {
	if !s.hasSaved {
		return
	}
	state := s.saved
	workAreas := make([]settings.WindowBounds, 0, len(screens))
	// The primary screen goes first so that a window whose display is gone
	// is centred on it.
	for _, primaryFirst := range []bool{true, false} {
		for _, screen := range screens {
			if screen != nil && screen.IsPrimary == primaryFirst {
				workAreas = append(workAreas, fromRect(screen.WorkArea))
			}
		}
	}
	placed := settings.PlaceWindow(state.Bounds, workAreas)
	// Wails creates the window a point smaller than asked for, so the frame
	// is set again even when the saved bounds fit on screen. The size goes
	// first: AppKit keeps the bottom edge when it resizes, and the position
	// is then set from the top edge.
	if fromRect(window.Bounds()) != placed {
		window.SetSize(placed.Width, placed.Height)
		window.SetPosition(placed.X, placed.Y)
	}
	s.mu.Lock()
	s.state = settings.WindowState{Bounds: placed, Maximised: state.Maximised, Fullscreen: state.Fullscreen}
	s.mu.Unlock()
	switch {
	case state.Fullscreen:
		window.Fullscreen()
	case state.Maximised:
		window.Maximise()
	}
}

// capture records the current state of the main window. The frame is only
// taken while the window is neither maximised, full screen nor minimised,
// so that the window can return to it.
func (s *MainWindowState) capture() {
	s.mu.Lock()
	window := s.window
	s.mu.Unlock()
	if window == nil {
		return
	}
	bounds := window.Bounds()
	if bounds.Width <= 0 || bounds.Height <= 0 {
		// The window is already gone.
		return
	}
	fullscreen := window.IsFullscreen()
	maximised := window.IsMaximised()
	minimised := window.IsMinimised()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !minimised {
		s.state.Fullscreen = fullscreen
		// AppKit reports a full screen window as zoomed too.
		s.state.Maximised = maximised && !fullscreen
	}
	if (!fullscreen && !maximised && !minimised) || !s.hasState {
		s.state.Bounds = fromRect(bounds)
		s.hasState = true
	}
}

// Save stores the last state of the main window. It is called while Glint
// shuts down, before the store is closed.
func (s *MainWindowState) Save(ctx context.Context) {
	s.capture()
	s.mu.Lock()
	state, ok := s.state, s.hasState
	s.mu.Unlock()
	if !ok {
		return
	}
	if err := s.store.SaveMainWindowState(ctx, state); err != nil {
		slog.Warn("save main window state", "error", err)
	}
}

func fromRect(rect application.Rect) settings.WindowBounds {
	return settings.WindowBounds{X: rect.X, Y: rect.Y, Width: rect.Width, Height: rect.Height}
}
