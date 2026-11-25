package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const mainWindowSettingKey = "window.main"

// ErrInvalidWindowSize reports window bounds without a positive width and height.
var ErrInvalidWindowSize = errors.New("window width and height must be positive")

// WindowBounds is a rectangle in screen points, with the origin at the
// top-left of the primary screen and Y growing downwards.
type WindowBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// WindowState is what the main window looks like when Glint quits. Bounds
// is the frame of the window when it is neither maximised nor full screen,
// so that the window can return to it after either state.
type WindowState struct {
	Bounds     WindowBounds `json:"bounds"`
	Maximised  bool         `json:"maximised"`
	Fullscreen bool         `json:"fullscreen"`
}

// GetMainWindowState returns the saved state of the main window, and false
// when no state has been saved yet.
func (manager *Manager) GetMainWindowState(ctx context.Context) (WindowState, bool, error) {
	value, err := manager.store.Setting(ctx, mainWindowSettingKey)
	if err != nil {
		return WindowState{}, false, err
	}
	if strings.TrimSpace(value) == "" {
		return WindowState{}, false, nil
	}
	var state WindowState
	if err := json.Unmarshal([]byte(value), &state); err != nil {
		return WindowState{}, false, fmt.Errorf("invalid saved window state: %w", err)
	}
	if !state.Bounds.hasArea() {
		return WindowState{}, false, fmt.Errorf("invalid saved window state: %w", ErrInvalidWindowSize)
	}
	return state, true, nil
}

func (manager *Manager) SaveMainWindowState(ctx context.Context, state WindowState) error {
	if !state.Bounds.hasArea() {
		return ErrInvalidWindowSize
	}
	value, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode window state: %w", err)
	}
	return manager.store.SaveSetting(ctx, mainWindowSettingKey, string(value))
}

// PlaceWindow moves saved bounds onto the screens that are connected now.
// The window goes to the work area it overlaps the most, shrinks to fit in
// it and moves inside it. When it overlaps none, for example because its
// display has been disconnected, it is centred on the first work area, which
// should be the primary screen. Without any work area the bounds are kept.
func PlaceWindow(bounds WindowBounds, workAreas []WindowBounds) WindowBounds {
	var target WindowBounds
	overlap := 0
	for _, area := range workAreas {
		if size := bounds.intersectionArea(area); size > overlap {
			target, overlap = area, size
		}
	}
	if overlap == 0 {
		for _, area := range workAreas {
			if area.hasArea() {
				return centre(bounds, area)
			}
		}
		return bounds
	}
	placed := WindowBounds{
		Width:  min(bounds.Width, target.Width),
		Height: min(bounds.Height, target.Height),
	}
	placed.X = clamp(bounds.X, target.X, target.X+target.Width-placed.Width)
	placed.Y = clamp(bounds.Y, target.Y, target.Y+target.Height-placed.Height)
	return placed
}

func centre(bounds, area WindowBounds) WindowBounds {
	width := min(bounds.Width, area.Width)
	height := min(bounds.Height, area.Height)
	return WindowBounds{
		X:      area.X + (area.Width-width)/2,
		Y:      area.Y + (area.Height-height)/2,
		Width:  width,
		Height: height,
	}
}

func (bounds WindowBounds) hasArea() bool {
	return bounds.Width > 0 && bounds.Height > 0
}

func (bounds WindowBounds) intersectionArea(other WindowBounds) int {
	width := min(bounds.X+bounds.Width, other.X+other.Width) - max(bounds.X, other.X)
	height := min(bounds.Y+bounds.Height, other.Y+other.Height) - max(bounds.Y, other.Y)
	if width <= 0 || height <= 0 {
		return 0
	}
	return width * height
}

func clamp(value, low, high int) int {
	return max(low, min(value, high))
}
