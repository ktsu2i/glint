package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const mainWindowSettingKey = "window.main"

var ErrInvalidWindowSize = errors.New("window width and height must be positive")

type WindowBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type WindowState struct {
	Bounds     WindowBounds `json:"bounds"`
	Maximised  bool         `json:"maximised"`
	Fullscreen bool         `json:"fullscreen"`
}

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

type Screen struct {
	WorkArea WindowBounds
	Primary  bool
}

func PlaceWindow(bounds WindowBounds, screens []Screen) WindowBounds {
	var target WindowBounds
	overlap := 0
	for _, screen := range screens {
		if size := bounds.intersectionArea(screen.WorkArea); size > overlap {
			target, overlap = screen.WorkArea, size
		}
	}
	if overlap == 0 {
		if area, ok := fallbackArea(screens); ok {
			return centre(bounds, area)
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

func fallbackArea(screens []Screen) (WindowBounds, bool) {
	var fallback WindowBounds
	found := false
	for _, screen := range screens {
		if !screen.WorkArea.hasArea() {
			continue
		}
		if screen.Primary {
			return screen.WorkArea, true
		}
		if !found {
			fallback, found = screen.WorkArea, true
		}
	}
	return fallback, found
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
