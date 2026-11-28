<h1 align="center">
  <img src="assets/logo.png" alt="Glint logo" width="128">
  <br>Glint
</h1>

<p align="center">
  <strong>A macOS reader for technical books.</strong>
  <br>
  Open PDFs and EPUBs, keep them on a local shelf, and search across everything you've read.
  <br>
  <br>
  <a href="#features">Features</a>
  ·
  <a href="#installation">Installation</a>
  ·
  <a href="https://github.com/ktsu2i/glint/releases/latest">Download</a>
</p>

<p align="center">
  <a href="https://github.com/ktsu2i/glint/releases/latest"><img src="https://img.shields.io/github/v/release/ktsu2i/glint?style=for-the-badge&label=Release" alt="Latest release"></a>
  <a href="https://github.com/ktsu2i/glint/actions/workflows/test.yaml"><img src="https://img.shields.io/github/actions/workflow/status/ktsu2i/glint/test.yaml?branch=main&style=for-the-badge&label=Test" alt="Test status"></a>
  <img src="https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey?style=for-the-badge&logo=apple" alt="macOS 13 or later">
</p>

<p align="center"><strong>English</strong> | <a href="README.ja.md">日本語</a></p>

<p align="center">
  <img src="assets/demo.gif" alt="Opening and reading a book in Glint" width="100%">
</p>

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
