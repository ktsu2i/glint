# AGENTS.md

このリポジトリで作業するエージェント向けのガイドです。作業前にこのファイル、README、現在のファイル構成を確認してください。

## プロジェクト概要

Glint は技術書を読むための macOS desktop app です。最終的には、読んでいる章・節・コードブロックをユーザー自身のローカルリポジトリに接続し、本とコードの両方に根拠を示しながら理解を助けることを目指しています。

中心はチャットではなく読書です。Glint の中核となる価値は book-to-repo mapping です。

## 現在地

実装済み:

- PDF / EPUB の import、表紙付きの本棚、名前の変更、削除、ファイルの再選択
- PDF reader（単ページ / 見開き、左綴じ / 右綴じ、拡大・縮小、目次、page slider、しおり、読み上げ）
- 本の中の検索と、本棚全体の横断検索
- 外観（light / dark / system）と UI 言語（英語 / 日本語）の設定
- Sparkle による自動アップデート

まだないもの:

- EPUB の閲覧画面（現在は placeholder）
- local repository の接続と index
- AI / LLM 機能。#23 で chat sidebar、LLM gateway、provider 設定を意図的にすべて削除しました。復活させる指示がない限り、chat UI や LLM 連携を作らないでください。

## ロードマップ

1. 既存の reader / library の基盤を整える（index 単位の一般化、検索の FTS5 化など）。
2. EPUB reader を作る。
3. local repository を 1つ接続し、repo files / symbols を index する。
4. `この章を自分のrepoで見る` を押すと、LLM なしで関連する repo files / symbols を、選ばれた理由とともに表示する。
5. 4 が LLM なしで成立した後に、book / repo citation 付きの説明生成を LLM の層として追加する。

`docs/` は gitignore 済みのローカル専用ディレクトリです。設計メモがある場合は参考にしてかまいませんが、commit 対象にはしないでください。

## リポジトリ構成

```text
main.go                 Wails app の起動、service の bind
internal/books          Wails に bind する books.Service（import、open、relink、検索、表紙、しおり）
internal/library        SQLite store（books、読書位置、page index、しおり、app settings）
internal/settings       外観と言語の設定
internal/assetserver    ローカルの本・表紙を token 付き URL で配信する
internal/sqlite         embed した SQL migration の適用
internal/update         Sparkle（`sparkle` build tag のときだけ有効）
migrations/             連番の SQL migration
frontend/src/features   library / reader / settings の UI
frontend/src/shared     Wails binding のラッパー、i18n、共通 component
frontend/wailsjs        Wails が生成する binding（手で編集しない）
```

PDF のテキスト抽出と表紙生成は frontend の PDF.js で行い、Wails 経由で backend に保存します。EPUB の解析、テキスト抽出、表紙抽出は Go で行います。

## 作業方針

- 日本語でコミュニケーションしてください。
- ユーザーから明示的に変更依頼がある場合は、提案だけで止まらず実装まで進めてください。
- 不要な抽象化や大きなリファクタリングは避け、依頼された範囲に絞ってください。
- 技術用語、API 名、型名、ファイル名、識別子は英語のままで構いません。
- ユーザーが作った可能性のある変更は勝手に戻さないでください。
- PR のタイトル・本文とコミットメッセージは英語で書いてください。

## プロダクト原則

- 読書優先: reader が主画面であり、他の機能は読書を補助する。
- ローカル優先: 本、index、読書状態、将来の repo index と mapping record はローカルに保存する。外部への通信はアップデート確認だけにする。
- 根拠優先: book-to-repo mapping の結果には、book location と repo path / symbol を必ず付ける。
- 説明可能な検索: なぜそのファイルや symbol が選ばれたかを表示する。
- LLM は後から足す層: retrieval は LLM なしで成立させる。LLM provider、embedding provider、vector store を UI や retrieval logic に直接結合しない。

## 技術スタック

- Desktop shell: Wails v2（macOS 13 以降）
- Frontend: React 19 + TypeScript + Vite、pnpm（`npm` は意図的に失敗する）
- Backend: Go
- PDF 表示 / 抽出: PDF.js
- Store: SQLite（`glebarez/sqlite` = pure Go の modernc SQLite、GORM）。schema 変更は `migrations/` に新しい連番ファイルを追加する。
- 検索: 現在は SQLite の LIKE。FTS5（trigram tokenizer）が使えるので、全文検索を強化する場合も別の検索エンジンは入れず SQLite で行う。
- Code parsing（repo 接続時）: Tree-sitter

## コマンド

```bash
go test ./...
golangci-lint run ./...
golangci-lint fmt ./...

cd frontend
pnpm test
pnpm check   # typecheck + oxlint + oxfmt --check + knip
pnpm run build
```

Go の service の公開メソッドを変更した場合は、`go tool wails build` または `wails dev` で `frontend/wailsjs` を再生成してください。`.github/workflows` を変更した場合は README に記載の actionlint などを実行してください。

## セキュリティ / プライバシー

- 本の内容はユーザーが提供した著作物として扱い、長い逐語引用を生成しないでください。
- repo を index する際は、`.env`、private key、credential file、dependency cache などを対象から除外してください。
- LLM を再導入する場合は、外部に送る内容をユーザーに明示し、送信前に redaction を行い、API key は OS の credential store に保存してください。

## テスト方針

- copyrighted な本や private repo に依存するテストは書かず、commit 可能な生成 PDF（`frontend/testdata`、`scripts/generate-reader-fixture.mjs`）と toy repo fixture を使ってください。
- Go のテストは testify と `t.Context()` を使います（golangci-lint で強制しています）。
- repo 接続を実装する際は、file discovery と除外ルール、Tree-sitter による symbol 抽出、retrieval の結果の融合を重点的にテストしてください。

## ファイル編集ルール

- Markdown ドキュメントは日本語で書いてください。README は `README.md`（英語）と `README.ja.md`（日本語）の両方を更新してください。
- コードや設定ファイルは既存の style に合わせてください。
- 生成物、依存ディレクトリ、秘密情報を commit 対象にしないでください。
