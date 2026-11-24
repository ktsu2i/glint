// Package app is the Wails binding layer. Its services are bound to the
// frontend, so their exported methods form the public API that Wails turns
// into TypeScript bindings. They open native dialogs, localize messages and
// convert results into DTOs, and leave the work itself to the feature
// packages. Only this package may import the Wails runtime.
package app

import (
	"context"
	"errors"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/kaito/glint/internal/settings"
)

var errNotReady = errors.New("application is not ready")

// base holds the Wails application context shared by the bound services.
type base struct {
	ctx context.Context
}

// ServiceStartup is a Wails lifecycle hook, excluded from frontend bindings.
func (b *base) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	b.ctx = ctx
	return nil
}

func (b *base) context() context.Context {
	if b.ctx == nil {
		return context.Background()
	}
	return b.ctx
}

func (b *base) ready() bool {
	return b.ctx != nil
}

// localizer picks native copy in the language the user chose.
type localizer struct {
	settings *settings.Manager
}

func (l localizer) text(ctx context.Context, english, japanese string) string {
	if l.settings == nil {
		return english
	}
	preference, err := l.settings.GetLanguage(ctx)
	if err == nil && preference.Language == settings.LanguageJapanese {
		return japanese
	}
	return english
}

func (l localizer) error(ctx context.Context, english, japanese string) error {
	return errors.New(l.text(ctx, english, japanese))
}
