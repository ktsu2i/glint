//go:build darwin && sparkle

package update

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework Sparkle
#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>

static SPUStandardUpdaterController *glintUpdaterController = nil;

static void glintInstallCheckForUpdatesMenuItem(void) {
	NSMenu *mainMenu = [NSApp mainMenu];
	if (mainMenu == nil || [mainMenu numberOfItems] == 0) {
		return;
	}
	NSMenu *appMenu = [[mainMenu itemAtIndex:0] submenu];
	if (appMenu == nil) {
		return;
	}
	SEL action = @selector(checkForUpdates:);
	for (NSMenuItem *item in [appMenu itemArray]) {
		if ([item action] == action) {
			return;
		}
	}
	NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:@"Check for Updates…"
		action:action
		keyEquivalent:@""];
	[item setTarget:glintUpdaterController];
	NSInteger index = [appMenu numberOfItems] > 0 ? 1 : 0;
	[appMenu insertItem:item atIndex:index];
}

static void glintStartUpdater(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (glintUpdaterController != nil) {
			return;
		}
		glintUpdaterController = [[SPUStandardUpdaterController alloc]
			initWithStartingUpdater:YES
			updaterDelegate:nil
			userDriverDelegate:nil];
		glintInstallCheckForUpdatesMenuItem();
	});
}
*/
import "C"

const Enabled = true

func Start() {
	C.glintStartUpdater()
}
