// Package app is the Wails binding layer. Its services are bound to the
// frontend, so their exported methods form the public API that Wails turns
// into TypeScript bindings. They open native dialogs, localize messages and
// convert results into DTOs, and leave the work itself to the feature
// packages. Only this package may import the Wails runtime.
package app

import (
	"context"
	"errors"

	"github.com/kaito/glint/internal/settings"
)

var errNotReady = errors.New("application is not ready")

// starter is implemented by every bound service. The method is unexported so
// that Wails does not expose it to the frontend.
type starter interface {
	startup(ctx context.Context)
}

// Startup hands the Wails application context to the bound services.
func Startup(ctx context.Context, services ...starter) {
	for _, service := range services {
		service.startup(ctx)
	}
}

// base holds the Wails application context shared by the bound services.
type base struct {
	ctx context.Context
}

func (b *base) startup(ctx context.Context) {
	b.ctx = ctx
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
