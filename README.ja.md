<h1 align="center">
  <img src="assets/logo.png" alt="Glint logo" width="128">
  <br>Glint
</h1>

<p align="center">
  <strong>PDF と EPUB を読むための macOS アプリ</strong>
  <br>
  PDF と EPUB を手元の本棚に並べて読み、読んだ本をまとめて全文検索できます。
  <br>
  <br>
  <a href="#主な機能">主な機能</a>
  ·
  <a href="#インストール">インストール</a>
  ·
  <a href="https://github.com/ktsu2i/glint/releases/latest">ダウンロード</a>
</p>

<p align="center">
  <a href="https://github.com/ktsu2i/glint/releases/latest"><img src="https://img.shields.io/github/v/release/ktsu2i/glint?style=for-the-badge&label=Release" alt="Latest release"></a>
  <a href="https://github.com/ktsu2i/glint/actions/workflows/test.yaml"><img src="https://img.shields.io/github/actions/workflow/status/ktsu2i/glint/test.yaml?branch=main&style=for-the-badge&label=Test" alt="Test status"></a>
  <img src="https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey?style=for-the-badge&logo=apple" alt="macOS 13 or later">
</p>

<p align="center"><a href="README.md">English</a> | <strong>日本語</strong></p>

<p align="center">
  <img src="assets/demo.gif" alt="Glint で本を開いて読む様子" width="100%">
</p>

## 主な機能

- **ローカルの本棚** — PDF / EPUB を追加し、前回読んでいたページから再開できます。
- **読みやすい表示** — 単ページと見開き、左綴じと右綴じ、ズーム、ライト / ダークモードに対応しています。
- **全文検索** — `⌘F` で、読んでいる本の中や本棚のすべての本を検索できます。
- **ハイライトとしおり** — 4 色のハイライトを引き、しおりを挟んで後から戻れます。
- **読み上げ** — ページを読み上げ、終わると自動で次のページへ進みます。
- **英語 / 日本語の UI**

## インストール

macOS 13 以降で動きます。

```bash
brew install --cask ktsu2i/tap/glint
```

[GitHub Releases](https://github.com/ktsu2i/glint/releases) から zip をダウンロードすることもできます。

> [!NOTE]
> Glint はまだ Apple の公証（notarization）を受けていないため、初回起動が macOS にブロックされます。**システム設定 > プライバシーとセキュリティ** で **このまま開く** を押すか、次のコマンドを実行してください。
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Glint.app
> ```

## アップデート

Glint は自動でアップデートを確認し、新しいバージョンがあればインストールを案内します。メニューバーの **Glint > Check for Updates…** から手動で確認するか、`brew upgrade --cask glint` を実行してアップデートすることもできます。

## プライバシー

本、読書位置、ハイライト、しおりはすべて Mac の中だけに保存されます。Glint が行う通信はアップデートの確認だけで、本の情報は送りません。
