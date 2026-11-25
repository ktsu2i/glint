package app

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/kaito/glint/internal/settings"
)

type fakeMainWindowStore struct {
	state   settings.WindowState
	ok      bool
	readErr error
	saved   []settings.WindowState
}

func (f *fakeMainWindowStore) GetMainWindowState(context.Context) (settings.WindowState, bool, error) {
	return f.state, f.ok, f.readErr
}

func (f *fakeMainWindowStore) SaveMainWindowState(_ context.Context, state settings.WindowState) error {
	f.saved = append(f.saved, state)
	return nil
}

func defaultMainWindowOptions() application.WebviewWindowOptions {
	return application.WebviewWindowOptions{Width: 1440, Height: 900, MinWidth: 1024, MinHeight: 700}
}

func TestMainWindowOptionsKeepDefaultsWithoutSavedState(t *testing.T) {
	state := NewMainWindowState(&fakeMainWindowStore{})

	options := state.Options(t.Context(), defaultMainWindowOptions())

	assert.Equal(t, defaultMainWindowOptions(), options)
}

func TestMainWindowOptionsKeepDefaultsWhenSavedStateIsBroken(t *testing.T) {
	state := NewMainWindowState(&fakeMainWindowStore{readErr: errors.New("invalid saved window state")})

	options := state.Options(t.Context(), defaultMainWindowOptions())

	assert.Equal(t, defaultMainWindowOptions(), options)
}

func TestMainWindowOptionsOpenWhereTheWindowWas(t *testing.T) {
	store := &fakeMainWindowStore{
		state: settings.WindowState{Bounds: settings.WindowBounds{X: -1800, Y: 60, Width: 1600, Height: 600}},
		ok:    true,
	}
	state := NewMainWindowState(store)

	options := state.Options(t.Context(), defaultMainWindowOptions())

	assert.Equal(t, application.WindowXY, options.InitialPosition)
	assert.Equal(t, -1800, options.X)
	assert.Equal(t, 60, options.Y)
	assert.Equal(t, 1600, options.Width)
	assert.Equal(t, 700, options.Height, "the height must not go below the minimum")
}

func TestMainWindowSaveWithoutWindowKeepsTheLoadedState(t *testing.T) {
	saved := settings.WindowState{Bounds: settings.WindowBounds{X: 10, Y: 20, Width: 1200, Height: 800}, Fullscreen: true}
	store := &fakeMainWindowStore{state: saved, ok: true}
	state := NewMainWindowState(store)
	state.Options(t.Context(), defaultMainWindowOptions())

	state.Save(t.Context())

	assert.Equal(t, []settings.WindowState{saved}, store.saved)
}

func TestMainWindowSaveWithoutAnyStateSavesNothing(t *testing.T) {
	store := &fakeMainWindowStore{}
	state := NewMainWindowState(store)

	state.Save(t.Context())

	assert.Empty(t, store.saved)
}
