package settings

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMainWindowStateIsMissingBeforeTheFirstSave(t *testing.T) {
	manager, _ := newTestManager()

	_, ok, err := manager.GetMainWindowState(t.Context())

	require.NoError(t, err)
	assert.False(t, ok)
}

func TestMainWindowStateRoundTrips(t *testing.T) {
	manager, _ := newTestManager()
	state := WindowState{
		Bounds:     WindowBounds{X: -1200, Y: 40, Width: 1280, Height: 820},
		Maximised:  true,
		Fullscreen: false,
	}

	require.NoError(t, manager.SaveMainWindowState(t.Context(), state))
	loaded, ok, err := manager.GetMainWindowState(t.Context())

	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, state, loaded)
}

func TestMainWindowStateRejectsEmptyBounds(t *testing.T) {
	manager, store := newTestManager()

	err := manager.SaveMainWindowState(t.Context(), WindowState{Bounds: WindowBounds{Width: 0, Height: 700}})

	assert.ErrorIs(t, err, ErrInvalidWindowSize)
	assert.NotContains(t, store.values, mainWindowSettingKey)
}

func TestMainWindowStateRejectsBrokenSavedValue(t *testing.T) {
	manager, store := newTestManager()

	store.values[mainWindowSettingKey] = "{"
	_, _, err := manager.GetMainWindowState(t.Context())
	assert.ErrorContains(t, err, "invalid saved window state")

	store.values[mainWindowSettingKey] = `{"bounds":{"width":-1,"height":10}}`
	_, _, err = manager.GetMainWindowState(t.Context())
	assert.ErrorIs(t, err, ErrInvalidWindowSize)
}

func TestPlaceWindow(t *testing.T) {
	primary := Screen{WorkArea: WindowBounds{X: 0, Y: 25, Width: 1512, Height: 920}, Primary: true}
	external := Screen{WorkArea: WindowBounds{X: 1512, Y: -300, Width: 2560, Height: 1415}}
	tests := []struct {
		name    string
		bounds  WindowBounds
		screens []Screen
		want    WindowBounds
	}{
		{
			name:    "keeps a window that fits on its screen",
			bounds:  WindowBounds{X: 100, Y: 80, Width: 1200, Height: 800},
			screens: []Screen{primary, external},
			want:    WindowBounds{X: 100, Y: 80, Width: 1200, Height: 800},
		},
		{
			name:    "keeps a window on the external screen",
			bounds:  WindowBounds{X: 2000, Y: -200, Width: 1800, Height: 1100},
			screens: []Screen{primary, external},
			want:    WindowBounds{X: 2000, Y: -200, Width: 1800, Height: 1100},
		},
		{
			name:    "centres a window whose screen is gone on the primary screen",
			bounds:  WindowBounds{X: 2000, Y: -200, Width: 1800, Height: 1100},
			screens: []Screen{primary},
			want:    WindowBounds{X: 0, Y: 25, Width: 1512, Height: 920},
		},
		{
			name:    "centres a small window whose screen is gone",
			bounds:  WindowBounds{X: 3000, Y: 0, Width: 1100, Height: 720},
			screens: []Screen{primary},
			want:    WindowBounds{X: 206, Y: 125, Width: 1100, Height: 720},
		},
		{
			name:    "moves a window that hangs over the edge back inside",
			bounds:  WindowBounds{X: 1000, Y: 600, Width: 1200, Height: 800},
			screens: []Screen{primary},
			want:    WindowBounds{X: 312, Y: 145, Width: 1200, Height: 800},
		},
		{
			name:    "uses the screen the window overlaps the most",
			bounds:  WindowBounds{X: 1300, Y: 100, Width: 1200, Height: 800},
			screens: []Screen{primary, external},
			want:    WindowBounds{X: 1512, Y: 100, Width: 1200, Height: 800},
		},
		{
			name:    "centres on the primary screen wherever it is listed",
			bounds:  WindowBounds{X: 5000, Y: 0, Width: 1100, Height: 720},
			screens: []Screen{external, primary},
			want:    WindowBounds{X: 206, Y: 125, Width: 1100, Height: 720},
		},
		{
			name:    "centres on another screen without a primary one",
			bounds:  WindowBounds{X: 5000, Y: 0, Width: 1100, Height: 720},
			screens: []Screen{{WorkArea: WindowBounds{}}, external},
			want:    WindowBounds{X: 2242, Y: 47, Width: 1100, Height: 720},
		},
		{
			name:    "keeps the bounds without any screen",
			bounds:  WindowBounds{X: 10, Y: 20, Width: 1200, Height: 800},
			screens: nil,
			want:    WindowBounds{X: 10, Y: 20, Width: 1200, Height: 800},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.want, PlaceWindow(test.bounds, test.screens))
		})
	}
}
