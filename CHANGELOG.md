# Changelog

## [v0.5.0](https://github.com/ktsu2i/glint/compare/v0.4.0...v0.5.0) - 2026-11-26

### New Features
- feat(reader): highlight selected text and review highlights in a panel by @ktsu2i in https://github.com/ktsu2i/glint/pull/50
- feat: remember the main window's size, position and state by @ktsu2i in https://github.com/ktsu2i/glint/pull/52
- feat: read EPUB books with foliate-js by @ktsu2i in https://github.com/ktsu2i/glint/pull/54
- feat: switch EPUB spreads and highlight EPUB text by @ktsu2i in https://github.com/ktsu2i/glint/pull/55
- feat: bookmark EPUB pages and read them aloud by @ktsu2i in https://github.com/ktsu2i/glint/pull/57
### Other Changes
- fix: keep the full-screen title bar as thin as a plain title bar by @ktsu2i in https://github.com/ktsu2i/glint/pull/53
- docs: restructure AGENTS.md around commands and boundaries by @ktsu2i in https://github.com/ktsu2i/glint/pull/58

## [v0.4.0](https://github.com/ktsu2i/glint/compare/v0.3.0...v0.4.0) - 2026-11-25

### New Features
- Redesign the reader and library with glass surfaces by @ktsu2i in https://github.com/ktsu2i/glint/pull/42
### Other Changes
- Strip the library down to its covers by @ktsu2i in https://github.com/ktsu2i/glint/pull/44
- feat(reader): hide the traffic lights with the reader toolbars by @ktsu2i in https://github.com/ktsu2i/glint/pull/45
- feat(library): find books by title in the library search by @ktsu2i in https://github.com/ktsu2i/glint/pull/46
- feat(reader): show the page layout icon on the view menu button by @ktsu2i in https://github.com/ktsu2i/glint/pull/47
- feat(library): sort the shelf by @ktsu2i in https://github.com/ktsu2i/glint/pull/48
- fix(reader): keep the read-aloud icon visible while reading by @ktsu2i in https://github.com/ktsu2i/glint/pull/49

## [v0.3.0](https://github.com/ktsu2i/glint/compare/v0.2.2...v0.3.0) - 2026-11-24

### New Features
- chore: migrate Glint to Wails v3 by @ktsu2i in https://github.com/ktsu2i/glint/pull/40

## [v0.2.2](https://github.com/ktsu2i/glint/compare/v0.2.1...v0.2.2) - 2026-11-24

### Other Changes
- refactor: replace GORM with sqlc for the library store by @ktsu2i in https://github.com/ktsu2i/glint/pull/35
- refactor: move Wails bindings into an app layer by @ktsu2i in https://github.com/ktsu2i/glint/pull/38
- docs: document backend architecture rules in AGENTS.md by @ktsu2i in https://github.com/ktsu2i/glint/pull/39

## [v0.2.1](https://github.com/ktsu2i/glint/compare/v0.2.0...v0.2.1) - 2026-11-24

### Other Changes
- docs: refresh AGENTS.md for the current reader-first state by @ktsu2i in https://github.com/ktsu2i/glint/pull/27
- chore: remove leftover APIs and unused plumbing by @ktsu2i in https://github.com/ktsu2i/glint/pull/29
- fix: skip rehashing unchanged books and keep bookmarks on content change by @ktsu2i in https://github.com/ktsu2i/glint/pull/30
- feat: back book search with an FTS5 trigram index by @ktsu2i in https://github.com/ktsu2i/glint/pull/31
- feat: generalize the page index into book segments by @ktsu2i in https://github.com/ktsu2i/glint/pull/32
- feat: unify segment indexing and resume unfinished books by @ktsu2i in https://github.com/ktsu2i/glint/pull/33

## [v0.2.0](https://github.com/ktsu2i/glint/compare/v0.1.5...v0.2.0) - 2026-11-24

### New Features
- chore: remove all AI features by @ktsu2i in https://github.com/ktsu2i/glint/pull/23
### Other Changes
- fix: open the library database on startup by @ktsu2i in https://github.com/ktsu2i/glint/pull/25
- chore: add golangci-lint by @ktsu2i in https://github.com/ktsu2i/glint/pull/26

## [v0.1.5](https://github.com/ktsu2i/glint/compare/v0.1.4...v0.1.5) - 2026-11-24

### Other Changes
- ci: lint GitHub Actions workflows with actionlint, jactionlint, ghalint and zizmor by @ktsu2i in https://github.com/ktsu2i/glint/pull/17
- chore(frontend): add strict lint, format, and dead-code checks by @ktsu2i in https://github.com/ktsu2i/glint/pull/19
- chore: remove CLAUDE.md symlink by @ktsu2i in https://github.com/ktsu2i/glint/pull/20
- chore: replace mise with aqua and a Go tool directive by @ktsu2i in https://github.com/ktsu2i/glint/pull/21
- chore: remove code comments by @ktsu2i in https://github.com/ktsu2i/glint/pull/22

## [v0.1.4](https://github.com/ktsu2i/glint/compare/v0.1.3...v0.1.4) - 2026-11-23

### Other Changes
- fix(release): make generate-appcast.sh executable by @ktsu2i in https://github.com/ktsu2i/glint/pull/15

## [v0.1.3](https://github.com/ktsu2i/glint/compare/v0.1.2...v0.1.3) - 2026-11-23

### Other Changes
- feat(update): add in-app updates with Sparkle by @ktsu2i in https://github.com/ktsu2i/glint/pull/13

## [v0.1.2](https://github.com/ktsu2i/glint/compare/v0.1.1...v0.1.2) - 2026-11-23

### Other Changes
- ci(release): switch from release-please to tagpr by @ktsu2i in https://github.com/ktsu2i/glint/pull/10
- ci(release): update the Homebrew tap after publishing a release by @ktsu2i in https://github.com/ktsu2i/glint/pull/12

## [0.1.1](https://github.com/ktsu2i/glint/compare/v0.1.0...v0.1.1) (2026-11-23)


### Bug Fixes

* **reader:** polyfill WeakMap upsert methods for pdfjs-dist 6.5 ([a79e86f](https://github.com/ktsu2i/glint/commit/a79e86f1fc174676570c3d53683aa4344dd118d8))
