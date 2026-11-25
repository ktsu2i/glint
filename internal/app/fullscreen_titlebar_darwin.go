//go:build darwin

package app

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

// glintSetToolbarVisible shows or hides the empty toolbar that the unified
// title bar style adds. Without it the title bar is only as tall as the
// traffic lights need.
static void glintSetToolbarVisible(void *nsWindow, bool visible) {
	dispatch_async(dispatch_get_main_queue(), ^{
		NSWindow *window = (__bridge NSWindow *)nsWindow;
		NSToolbar *toolbar = window.toolbar;
		if (toolbar != nil) {
			toolbar.visible = visible;
		}
	});
}
*/
import "C"

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// CompactFullscreenTitleBar keeps the title bar that macOS reveals at the top
// of a full-screen window as thin as a plain title bar. The unified style's
// toolbar gives the windowed title bar its inset traffic lights, but in full
// screen it only makes the revealed bar thicker, so it is hidden there.
func CompactFullscreenTitleBar(window *application.WebviewWindow) {
	setToolbarVisible := func(visible bool) func(*application.WindowEvent) {
		return func(*application.WindowEvent) {
			nsWindow := window.NativeWindow()
			if nsWindow == nil {
				return
			}
			C.glintSetToolbarVisible(nsWindow, C.bool(visible))
		}
	}
	window.OnWindowEvent(events.Mac.WindowWillEnterFullScreen, setToolbarVisible(false))
	window.OnWindowEvent(events.Mac.WindowWillExitFullScreen, setToolbarVisible(true))
}
