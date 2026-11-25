//go:build !darwin

package app

import "github.com/wailsapp/wails/v3/pkg/application"

// CompactFullscreenTitleBar only changes the macOS title bar.
func CompactFullscreenTitleBar(*application.WebviewWindow) {}
