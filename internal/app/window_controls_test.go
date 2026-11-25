package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

type fakeWindowControls struct {
	calls []bool
}

func (f *fakeWindowControls) SetVisible(visible bool) {
	f.calls = append(f.calls, visible)
}

func TestSetWindowControlsVisiblePassesVisibilityToControls(t *testing.T) {
	controls := &fakeWindowControls{}
	service := NewWindowService(controls)

	service.SetWindowControlsVisible(false)
	service.SetWindowControlsVisible(true)

	assert.Equal(t, []bool{false, true}, controls.calls)
}

func TestSetWindowControlsVisibleWithoutControlsDoesNothing(t *testing.T) {
	assert.NotPanics(t, func() {
		NewWindowService(nil).SetWindowControlsVisible(false)
	})
}

func TestNativeWindowControlsWithoutWindowDoesNothing(t *testing.T) {
	assert.NotPanics(t, func() {
		NewNativeWindowControls(nil).SetVisible(false)
	})
}
