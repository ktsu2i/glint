package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type fakeWindowButtons struct {
	close, minimise, maximise application.ButtonState
}

func (f *fakeWindowButtons) SetCloseButtonState(state application.ButtonState) application.Window {
	f.close = state
	return nil
}

func (f *fakeWindowButtons) SetMinimiseButtonState(state application.ButtonState) application.Window {
	f.minimise = state
	return nil
}

func (f *fakeWindowButtons) SetMaximiseButtonState(state application.ButtonState) application.Window {
	f.maximise = state
	return nil
}

func TestSetWindowControlsVisibleHidesAndShowsAllButtons(t *testing.T) {
	window := &fakeWindowButtons{}
	service := NewWindowService(window)

	service.SetWindowControlsVisible(false)
	assert.Equal(t, &fakeWindowButtons{
		close:    application.ButtonHidden,
		minimise: application.ButtonHidden,
		maximise: application.ButtonHidden,
	}, window)

	service.SetWindowControlsVisible(true)
	assert.Equal(t, &fakeWindowButtons{
		close:    application.ButtonEnabled,
		minimise: application.ButtonEnabled,
		maximise: application.ButtonEnabled,
	}, window)
}

func TestSetWindowControlsVisibleWithoutWindowDoesNothing(t *testing.T) {
	assert.NotPanics(t, func() {
		NewWindowService(nil).SetWindowControlsVisible(false)
	})
}
