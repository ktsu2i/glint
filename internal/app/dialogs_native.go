//go:build !verify

package app

import "github.com/wailsapp/wails/v3/pkg/application"

func newDialogs(desktop *application.App) dialogs {
	return wailsDialogs{app: desktop}
}
