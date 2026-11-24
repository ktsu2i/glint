package app

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDialogsRejectCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	dialog := wailsDialogs{}
	path, err := dialog.chooseBookFile(ctx, "Choose book")
	assert.Empty(t, path)
	assert.ErrorIs(t, err, context.Canceled)
	accepted, err := dialog.confirm(ctx, confirmation{})
	assert.False(t, accepted)
	assert.ErrorIs(t, err, context.Canceled)
}
