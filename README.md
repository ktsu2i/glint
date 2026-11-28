# Glint

**English** | [日本語](README.ja.md)

A macOS reader for technical books. Open PDFs and EPUBs, keep them on a local shelf, and search across everything you've read.

![Glint library](assets/library-en.png)

## Features

- **Local library** — Add PDFs and EPUBs and pick up where you left off.
- **Comfortable reading** — Single pages or two-page spreads, left or right binding, zoom, and light / dark mode.
- **Full-text search** — Search inside a book or across your whole library with `⌘F`.
- **Highlights and bookmarks** — Highlight text in four colors and bookmark pages to come back to.
- **Read aloud** — Have the page read to you, turning pages automatically.
- **English and Japanese UI**

## Installation

Glint requires macOS 13 or later.

```bash
brew install --cask ktsu2i/tap/glint
```

Or download the zip from [GitHub Releases](https://github.com/ktsu2i/glint/releases).

> [!NOTE]
> Glint is not notarized by Apple yet, so macOS blocks the first launch. Open **System Settings > Privacy & Security** and click **Open Anyway**, or run:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Glint.app
> ```

## Updating

Glint checks for updates automatically and offers to install new versions. You can also choose **Glint > Check for Updates…** from the menu bar, or run `brew upgrade --cask glint`.

## Privacy

Your books, reading positions, highlights, and bookmarks are stored only on your Mac. The only network request Glint makes is the update check, which sends nothing about your books.

## Roadmap

Glint will connect the book you're reading to your own code: point it at a local repository and jump from a chapter to the files and symbols it describes. This is in progress.
