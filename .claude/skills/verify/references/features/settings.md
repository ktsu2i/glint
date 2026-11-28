# Settings

The settings window: the display theme (Light, Dark, System) and the interface language (English, Japanese). Both are app-wide and stored in `app_settings`.

## Sub-features

- theme: "Light", "Dark", or "System" under "Display theme"; stored as `appearance.theme`. The library and reader chrome follow it, and EPUB text is recolored; PDF pages keep their own colors
- system-theme: "System" follows the OS appearance (`prefers-color-scheme`) and switches live when it changes
- language: "English" or "Japanese" under "Interface language"; stored as `application.language`. All UI text and translated error messages follow it, and `<html lang>` changes
- tabs: "Appearance" and "Language" in the "Settings sections" tab list
- persistence: both settings survive restarts and apply to every window

## How to get to it (user POV)

Glint menu → Settings… (⌘,) opens a separate settings window.

## Driving it with go tool verify

The native menu and the separate window are out of reach, but the window is the same app at `/#settings`, so open it in the page. The hash is read on load, so reload after `open`.

```bash
go tool verify open "/#settings"
go tool verify reload
go tool verify snapshot                  # heading "Appearance", tabs, "Display theme" buttons

# theme
go tool verify click button "Dark"
go tool verify sql "select value from app_settings where key = 'appearance.theme'"    # dark
go tool verify eval "({ theme: document.documentElement.dataset.theme, scheme: getComputedStyle(document.documentElement).colorScheme })"

# System follows the OS appearance, which the driver can emulate
go tool verify click button "/^System/"
go tool verify color-scheme dark
go tool verify eval "document.documentElement.dataset.theme"     # "dark"
go tool verify color-scheme light
go tool verify eval "document.documentElement.dataset.theme"     # "light"

# language
go tool verify click tab "Language"
go tool verify click button "/^Japanese/"
go tool verify sql "select value from app_settings where key = 'application.language'"   # ja
go tool verify snapshot                  # heading "言語", tabs "表示" and "言語"

# the main window follows after a reload (it is a separate window in the app)
go tool verify open "/"
go tool verify reload
go tool verify snapshot                  # heading "本棚", button "本を追加"
go tool verify eval "({ lang: document.documentElement.lang, theme: document.documentElement.dataset.theme })"

# readers in the dark theme: keep screenshots of both
go tool verify screenshot /path/to/dark-pdf.png        # chrome dark, PDF page still white
go tool verify eval --in-book "getComputedStyle(document.body).color"   # light text in an EPUB

# persistence
go tool verify restart-app
go tool verify eval "({ lang: document.documentElement.lang, theme: document.documentElement.dataset.theme })"
```

To check translated errors, switch to Japanese and run the error paths in [library](library.md).

## Gotchas

- `open "/#settings"` from `/` is a same-document navigation and does not switch screens. Always `reload` after `open` when changing between `/` and `/#settings`.
- In the app the settings window tells the main window about changes through Wails events. The driver has one page, so it checks the main window after a reload instead. Live updates across two windows are a gap; check them in the real app.
- Once the UI is in Japanese, every label changes ("Add Book" → "本を追加", "Library" → "本棚"). Use the Japanese names, or switch back to English before running other feature files.
- Button names include their description ("English Use Glint in English"), so match them with `/^English/` or `/^Japanese/`. In Japanese the theme buttons are "ライト", "ダーク", and "システム".
- The driver's emulated OS appearance starts as light. It only matters while the theme is "System".
- With no saved language, Glint uses English regardless of the OS or browser locale.
- The application menu and ⌘, are native and out of reach.
