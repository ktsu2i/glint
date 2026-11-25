//go:build darwin

package app

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework QuartzCore
#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>

static NSInteger glintWindowControlsGeneration = 0;

// glintSetWindowControlsVisible fades the traffic lights with the same
// duration and curve as the CSS "ease" transition of the reader toolbars.
// Faded-out buttons are hidden as well so that they cannot be clicked.
static void glintSetWindowControlsVisible(void *nsWindow, bool visible, double duration) {
	dispatch_async(dispatch_get_main_queue(), ^{
		NSWindow *window = (__bridge NSWindow *)nsWindow;
		NSMutableArray<NSButton *> *buttons = [NSMutableArray array];
		NSWindowButton kinds[] = {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton};
		for (int i = 0; i < 3; i++) {
			NSButton *button = [window standardWindowButton:kinds[i]];
			if (button != nil) {
				[buttons addObject:button];
			}
		}
		NSInteger generation = ++glintWindowControlsGeneration;
		if (visible) {
			for (NSButton *button in buttons) {
				button.hidden = NO;
			}
		}
		[NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
			context.duration = duration;
			context.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.25 :0.1 :0.25 :1.0];
			for (NSButton *button in buttons) {
				button.animator.alphaValue = visible ? 1.0 : 0.0;
			}
		} completionHandler:^{
			if (visible || generation != glintWindowControlsGeneration) {
				return;
			}
			for (NSButton *button in buttons) {
				button.hidden = YES;
			}
		}];
	});
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// windowControlsFadeSeconds matches the opacity transition of .reader-topbar
// in frontend/src/styles.css.
const windowControlsFadeSeconds = 0.18

// NativeWindowControls fades the traffic lights of a window through AppKit,
// since Wails can only switch them on and off at once.
type NativeWindowControls struct {
	window *application.WebviewWindow
}

func NewNativeWindowControls(window *application.WebviewWindow) *NativeWindowControls {
	return &NativeWindowControls{window: window}
}

func (c *NativeWindowControls) SetVisible(visible bool) {
	if c.window == nil {
		return
	}
	nsWindow := c.window.NativeWindow()
	if nsWindow == nil {
		return
	}
	C.glintSetWindowControlsVisible(nsWindow, C.bool(visible), C.double(windowControlsFadeSeconds))
}
