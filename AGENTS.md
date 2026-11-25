# AGENTS.md

このリポジトリで作業するエージェント向けのガイドです。作業前にこのファイル、README、現在のファイル構成を確認してください。

## プロジェクト概要

Glint は技術書を読むための macOS desktop app です。最終的には、読んでいる章・節・コードブロックをユーザー自身のローカルリポジトリに接続し、本とコードの両方に根拠を示しながら理解を助けることを目指しています。

中心はチャットではなく読書です。Glint の中核となる価値は book-to-repo mapping です。

## 現在地

実装済み:

- PDF / EPUB の import、表紙付きの本棚、名前の変更、削除、ファイルの再選択
- PDF reader（単ページ / 見開き、左綴じ / 右綴じ、拡大・縮小、目次、page slider、しおり、読み上げ）
- EPUB reader（foliate-js によるページ送り、片開き / 見開き、目次、本の中の検索、文字サイズ、ハイライト）
- 本の中の検索と、本棚全体の横断検索
- 外観（light / dark / system）と UI 言語（英語 / 日本語）の設定
- Sparkle による自動アップデート

まだないもの:

- EPUB のしおり、読み上げ
- local repository の接続と index
- AI / LLM 機能。#23 で chat sidebar、LLM gateway、provider 設定を意図的にすべて削除しました。復活させる指示がない限り、chat UI や LLM 連携を作らないでください。

## ロードマップ

1. 既存の reader / library の基盤を整える（index 単位の一般化、検索の FTS5 化など）。
2. EPUB reader を作る（閲覧とハイライトは実装済み。しおり・読み上げは未対応）。
3. local repository を 1つ接続し、repo files / symbols を index する。
4. `この章を自分のrepoで見る` を押すと、LLM なしで関連する repo files / symbols を、選ばれた理由とともに表示する。
5. 4 が LLM なしで成立した後に、book / repo citation 付きの説明生成を LLM の層として追加する。

`docs/` は gitignore 済みのローカル専用ディレクトリです。設計メモがある場合は参考にしてかまいませんが、commit 対象にはしないでください。

## リポジトリ構成

```text
main.go                    Wails app の起動、依存の組み立て、service の bind
internal/app               Wails に bind する service（BooksService、SettingsService）、DTO、native dialog、エラーの i18n
internal/books             本の usecase（import、open、relink、検索、表紙、しおり）と PDF / EPUB の解析
internal/library           SQLite store（books、読書位置、page index、しおり、app settings）
internal/library/queries   sqlc の query（`*.sql`）
internal/library/librarydb sqlc が生成する Go コード（手で編集しない）
internal/settings          外観と言語の設定
internal/assetserver       ローカルの本・表紙を token 付き URL で配信する
internal/sqlite            embed した SQL migration の適用
internal/update            Sparkle（`sparkle` build tag のときだけ有効）
migrations/                連番の SQL migration
frontend/src/features      library / reader / settings の UI
frontend/src/shared        Wails binding のラッパー、i18n、共通 component
frontend/bindings           Wails が生成する binding（手で編集・commit しない）
```

PDF のテキスト抽出と表紙生成は frontend の PDF.js で行い、Wails 経由で backend に保存します。EPUB の解析、テキスト抽出、表紙抽出は Go で行います。EPUB の表示は frontend の foliate-js（commit を固定した git 依存）で行い、EPUB ファイルを `/book/<token>` から取得して `blob:` URL の iframe に描画します。ハイライトは `book_highlights` に、PDF はページ上の矩形（`rects`）、EPUB は CFI（`cfi`）のどちらか一方で位置を保存します。

## アーキテクチャ

Go の backend は機能単位の package で縦に分け、Wails との境界だけを `internal/app` に置きます。Web の layered architecture に当てはめると、`internal/app` が handler、機能 package が usecase と model、`internal/library` が repository に当たります。

### 依存の向き

```text
main.go ─→ internal/app ─→ 機能 package（books、settings、将来の repoindex / mapping）─→ internal/library
                │                                                                          └→ internal/sqlite
                └→ internal/assetserver（platform adapter）
```

- 逆向きの import は禁止です。機能 package から `internal/app` を、`internal/library` から機能 package を import しないでください。
- 機能 package 同士の依存は最小限にし、循環させないでください。
- Wails v3 の `application` / `events` を import してよいのは `main.go` と `internal/app` だけです。`main.go` はアプリ・window・service の組み立てと lifecycle 管理を行います。

### `internal/app`（Wails の bind 層）

frontend に公開する API です。bind した struct の exported method は、すべて TypeScript の binding として公開されます。

- **ここで行うこと:** native dialog（ファイル選択、確認）、エラーをユーザーの言語に訳すこと、DTO への変換、asset server への URL 登録、Wails の events の送信。
- **ここで行わないこと:** 業務ロジック、SQL、ファイルの解析。処理は機能 package の usecase を呼んで任せてください。
- 返り値は `internal/app` に定義した DTO（json tag 付き）にします。domain の型（`library.Book` など）を直接返さないでください。
- frontend に公開しない method は unexported にします。Wails の context は共通の `base.ServiceStartup` で受け取ります。`ServiceStartup` は v3 が bindings から除外する lifecycle hook です。それ以外の内部処理を exported method にしないでください。
- dialog を開く method は、起動前に呼ばれたら `errNotReady` を返します。
- エラーの翻訳は `errors.Is` で sentinel error を判定し、英語と日本語の両方を書きます（`localizer`）。翻訳しないエラーはそのまま返します。
- frontend から受け取った値は信用せず、usecase 側で検証します。data URL のような転送用の形式は、`internal/app` で decode してから usecase に渡します。

### 機能 package（usecase と domain）

`internal/books`、`internal/settings`、将来の repo index や mapping が当たります。

- Wails、`internal/app`、`internal/assetserver` に依存しません。
- method は `ctx context.Context` を第 1 引数に取ります。context を struct に保持しないでください。
- 入力は path や ID などの値で受け取ります。dialog を開く、ユーザーに確認する、といった UI 操作は `internal/app` で済ませ、結果だけを受け取ります。
- 返り値は domain の型です。ユーザーが対処できる失敗は、package に定義した sentinel error（`var ErrXxx = errors.New(...)`）で返し、`fmt.Errorf("...: %w", err)` で包んでも `errors.Is` で判定できるようにします。
- UI に表示する文言（日本語 / 英語）を持ちません。

### `internal/library`（store）

- SQLite への読み書きだけを行います。query は sqlc で生成し、動的な query だけ `database/sql` で手書きします。
- 入力の形式的な検証（長さ、範囲）は store でも行い、sentinel error を返します。

### interface

- interface は使う側の package に、必要になったときだけ定義します。repository ごとに interface を用意しないでください。
- 定義するのは、test で fake に差し替えたいもの（native dialog、外部プロセス、時計など）や、実装を切り替える必要があるものに限ります。例: `internal/app` の `dialogs`、`internal/settings` の `SettingStore`。
- LLM provider、embedding provider、vector store を導入する場合は、retrieval logic から interface 越しに使い、具体的な実装に直接結合しないでください。

### 時間のかかる処理

repo の index のように時間のかかる処理は、次のように作ります。

- usecase は `ctx` を受け取り、cancel されたら途中で止まるようにします。
- 起動と終了は service の `ServiceStartup` / `ServiceShutdown` と `main.go` の `OnShutdown` から管理し、終了時に止めます。
- 進捗や完了は `internal/app` から Wails の events で frontend に push します。frontend に polling させないでください。

### 新しい機能を追加するとき

例として repo 接続を追加する場合は、次の順に作ります。

1. `internal/<feature>` に usecase と domain の型、sentinel error を書き、test する。
2. 永続化が必要なら `migrations/` に migration を追加し、`internal/library/queries` に query を書いて `go tool sqlc generate` する。
3. `internal/app` に bind する service と DTO を追加し、dialog や翻訳、DTO 変換を書く。service に共通の `base` を埋め込み、`ServiceStartup` で context を受け取る。
4. `main.go` で組み立て、`application.NewService` と `RegisterService` で登録する。
5. `go tool wails3 generate bindings -ts -i` で `frontend/bindings` を再生成し、`frontend/src/shared/api` の wrapper から呼ぶ。

### test の分け方

- 機能 package: usecase を実物の SQLite（`t.TempDir()`）と生成した fixture で test し、domain の型と sentinel error（`assert.ErrorIs`）を確認する。
- `internal/app`: fake の dialog を使い、DTO への変換、asset URL の配信、エラーの翻訳、dialog のキャンセルや失敗の扱いを確認する。

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

- Desktop shell: Wails v3（macOS 13 以降）
- Frontend: React 19 + TypeScript + Vite、pnpm（`npm` は意図的に失敗する）
- Backend: Go
- PDF 表示 / 抽出: PDF.js
- Store: SQLite（`glebarez/go-sqlite` = pure Go の modernc SQLite、`database/sql`）。query は sqlc で生成する（`sqlc.yaml`、`go tool sqlc`）。schema 変更は `migrations/` に新しい連番ファイルを追加する。sqlc で表せない動的な query（条件の数が変わる検索など）だけ `database/sql` で手書きする。
- sqlc の SQLite parser の制約: FTS5 の `MATCH` は table 名ではなく列名に対して書き（`book_segments_fts.text MATCH ?`）、並び順は `bm25()` ではなく `rank` 列を使う。入れ子の subquery ではすべての table に alias を付ける。
- EPUB 表示: foliate-js。iframe は WebKit の都合で `allow-scripts` が必要なため、EPUB の script は本番ビルドの CSP（`frontend/vite.config.ts`、`script-src 'self'`）と、読み込み時の除去（`epubContent.ts` の `guardEpubContent`）で止めている。CSP を緩めないこと。dev server では CSP が効かない。
- 検索: 現在は SQLite の LIKE。FTS5（trigram tokenizer）が使えるので、全文検索を強化する場合も別の検索エンジンは入れず SQLite で行う。
- Code parsing（repo 接続時）: Tree-sitter

## コマンド

```bash
go test ./...
go tool wails3 generate bindings -ts -i
golangci-lint run ./...
golangci-lint fmt ./...
go tool sqlc generate   # queries / migrations を変更したとき
go tool sqlc diff       # 生成コードが最新か確認

cd frontend
pnpm test
pnpm check   # typecheck + oxlint + oxfmt --check + knip
pnpm run build
```

Go の service の公開メソッドを変更した場合は、`go tool wails3 build` または `go tool wails3 generate bindings -ts -i` で `frontend/bindings` を再生成してください。`.github/workflows` を変更した場合は README に記載の actionlint などを実行してください。

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
