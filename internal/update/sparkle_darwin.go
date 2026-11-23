//go:build darwin && sparkle

// Package update は Sparkle (https://sparkle-project.org/) による自己更新を扱う。
//
// `sparkle` build tag を付けたときだけ Sparkle.framework にリンクする。tag なしの
// ビルド（`wails dev`、`go test` など）では sparkle_stub.go の何もしない実装になる。
//
// framework の場所 (-F) と rpath (-Wl,-rpath,@executable_path/../Frameworks) は
// CGO_CFLAGS / CGO_LDFLAGS で渡す。#cgo 行では @ を含むフラグを使えないため。
// 更新の配信元 (SUFeedURL) と検証用の公開鍵 (SUPublicEDKey) は Info.plist に書く。
package update

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework Sparkle
#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>

static SPUStandardUpdaterController *glintUpdaterController = nil;

// アプリメニュー（先頭の「Glint」メニュー）の About の直後に
// 「Check for Updates…」を差し込む。Wails の menu API ではアプリメニューに
// 項目を足せないため、Cocoa 側で直接追加する。
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
		// startingUpdater:YES で、Info.plist の設定に沿った定期的な更新確認が始まる。
		// 新しい版が見つかると Sparkle 標準のウィンドウで「Install Update」を案内する。
		glintUpdaterController = [[SPUStandardUpdaterController alloc]
			initWithStartingUpdater:YES
			updaterDelegate:nil
			userDriverDelegate:nil];
		glintInstallCheckForUpdatesMenuItem();
	});
}
*/
import "C"

// Enabled は Sparkle を組み込んだビルドかどうかを返す。
const Enabled = true

// Start は Sparkle の updater を起動し、アプリメニューに「Check for Updates…」を追加する。
// Wails の OnStartup から呼ぶ。実際の処理はメインスレッドで非同期に行う。
func Start() {
	C.glintStartUpdater()
}
