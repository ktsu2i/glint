# AGENTS.md

Glint で作業するエージェント向けのガイドです。人向けの説明（機能一覧、インストール、リリース手順）は `README.ja.md` にあり、ここでは重ねて書きません。

## プロジェクト概要

Glint は技術書（PDF / EPUB）を読むための macOS desktop app です。中心はチャットではなく読書で、最終的には読んでいる章・節・コードブロックをユーザーのローカルリポジトリに接続し、本とコードの両方に根拠を示しながら理解を助けること（book-to-repo mapping）を目指しています。

- 実装済み: PDF / EPUB の reader と本棚、本の中と本棚全体の全文検索、ハイライト、しおり、読み上げ、外観と UI 言語の設定、Sparkle による自動アップデート。詳細は README を参照してください。
- 未実装: local repository の接続と index、book-to-repo mapping。
- AI / LLM 機能は #23 で chat sidebar、LLM gateway、provider 設定ごと意図的に削除しました。指示がない限り、chat UI や LLM 連携を作らないでください。

## コマンド

```bash
# Go
go test ./...
golangci-lint run ./...
golangci-lint fmt ./...
go tool sqlc generate                     # queries / migrations を変更したとき
go tool sqlc diff                         # 生成コードが最新か確認
go tool wails3 generate bindings -ts -i   # Go service の公開 method を変更したとき

# frontend（pnpm のみ。npm は意図的に失敗する）
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm check          # typecheck + oxlint + oxfmt --check + knip
pnpm lint:fix
pnpm format
pnpm run build

# アプリ
go tool wails3 dev     # live reload 付きで起動
go tool wails3 build   # build/bin/Glint.app を作る
```

- `frontend/bindings` は生成物で commit しません。新しい checkout では、frontend の test / check の前に bindings を生成してください。
- CI（Linux、`CGO_ENABLED=0`）は `-tags server` を付けて Go の test、lint、bindings 生成を行います。macOS の手元では tag は不要です。

### 作業を終える前に

変更した範囲に応じて、CI と同じ検査を通してください。

- Go を変更した: `go test ./...`、`golangci-lint run ./...`、`golangci-lint fmt ./...`
- query / migration を変更した: `go tool sqlc generate` のうえで `go tool sqlc diff`
- Go service の公開 method を変更した: bindings を再生成してから frontend の検査
- frontend を変更した: `pnpm check`、`pnpm test`、`pnpm run build`
- `.github/workflows` を変更した: `actionlint`、`jactionlint`、`ghalint run`、`zizmor .`（版は `aqua.yaml` で固定）

## 作業方針

- ユーザーとは日本語でやり取りしてください。技術用語、API 名、型名、ファイル名、識別子は英語のままで構いません。
- 明示的な変更依頼がある場合は、提案で止まらず実装まで進めてください。
- 依頼された範囲に絞り、不要な抽象化や大きなリファクタリングは避けてください。
- コードや設定ファイルは既存の style に合わせてください。
- Markdown ドキュメントは日本語で書きます。README を変更するときは `README.md`（英語）と `README.ja.md`（日本語）の両方を更新してください。

### Git / PR

- branch は `feat/...`、`fix/...`、`docs/...`、`chore/...` の形で切り、`main` に直接 commit しません。
- コミットメッセージは Conventional Commits（`feat:`、`fix:`、`docs:`、`refactor:`、`chore:` など）で、英語で書きます。
- PR のタイトルと本文も英語で書きます。リリースは tagpr が管理するので、version や `CHANGELOG.md` を手で変更しないでください。

### 境界

- **必ず行う:** 変更範囲に応じた上記の検査、新しい usecase と store への test、schema 変更時の新しい連番 migration。
- **事前に確認する:** 新しい依存の追加、既存 table の作り直しを伴う schema 変更、CSP やセキュリティ設定の変更、CI / release workflow の変更。
- **しない:** 生成物（`internal/library/librarydb`、`frontend/bindings`）の手編集、既存 migration の編集、`docs/`（gitignore 済みのローカル専用。設計メモとして参照するのは可）の commit、秘密情報の commit、ユーザーが作った可能性のある変更を勝手に戻すこと。

## リポジトリ構成

```text
main.go                    Wails app の起動、依存の組み立て、service の bind
internal/app               Wails に bind する service（BooksService、SettingsService）、DTO、native dialog、エラーの i18n
internal/books             本の usecase（import、open、relink、検索、表紙、ハイライト、しおり）と PDF / EPUB の解析
internal/library           SQLite store（books、読書位置、book segments と全文検索、ハイライト、しおり、app settings）
internal/library/queries   sqlc の query（`*.sql`）
internal/library/librarydb sqlc が生成する Go コード（手で編集しない）
internal/settings          外観と言語の設定
internal/assetserver       ローカルの本・表紙を token 付き URL で配信する
internal/sqlite            embed した SQL migration の適用
internal/update            Sparkle（`darwin` かつ `sparkle` build tag のときだけ有効）
migrations/                連番の SQL migration
frontend/src/features      library / reader / settings の UI
frontend/src/shared        Wails binding のラッパー（`api`）、i18n、共通 component
frontend/bindings          Wails が生成する binding（手で編集・commit しない）
frontend/testdata          commit 可能な生成 PDF fixture
```

### 本のデータの流れ

- PDF: テキスト抽出と表紙生成は frontend の PDF.js で行い、Wails 経由で backend に保存します。
- EPUB: 解析、テキスト抽出、表紙抽出は Go で行います。表示は frontend の foliate-js（commit を固定した git 依存）で行い、EPUB ファイルを `/book/<token>` から取得して `blob:` URL の iframe に描画します。
- 検索用のテキストは `book_segments`（PDF はページ、EPUB は section 単位）に保存し、FTS5（trigram）の `book_segments_fts` で検索します。
- ハイライトは `book_highlights` に、PDF はページ上の矩形（`rects`）、EPUB は CFI（`cfi`）のどちらか一方で位置を保存します。
- しおりは `book_bookmarks` に、PDF はページ番号、EPUB はページ先頭の CFI と本全体での位置（`progress`）で保存します。

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

bind した struct の exported method は、すべて TypeScript の binding として frontend に公開されます。

- **行うこと:** native dialog（ファイル選択、確認）、エラーをユーザーの言語に訳すこと、DTO への変換、asset server への URL 登録、Wails の events の送信。
- **行わないこと:** 業務ロジック、SQL、ファイルの解析。処理は機能 package の usecase に任せます。
- 返り値は `internal/app` に定義した DTO（json tag 付き）にし、domain の型（`library.Book` など）を直接返しません。
- frontend に公開しない method は unexported にします。Wails の context は共通の `base` が `ServiceStartup`（v3 が bindings から除外する lifecycle hook）で受け取ります。それ以外の内部処理を exported method にしないでください。
- dialog を開く method は、起動前に呼ばれたら `errNotReady` を返します。
- エラーの翻訳は `errors.Is` で sentinel error を判定し、英語と日本語の両方を書きます（`localizer`）。翻訳しないエラーはそのまま返します。
- frontend から受け取った値は信用せず、usecase 側で検証します。data URL のような転送用の形式は `internal/app` で decode してから usecase に渡します。

### 機能 package（usecase と domain）

`internal/books`、`internal/settings`、将来の repo index や mapping が当たります。

- Wails、`internal/app`、`internal/assetserver` に依存しません。
- method は `ctx context.Context` を第 1 引数に取り、context を struct に保持しません。
- 入力は path や ID などの値で受け取ります。dialog やユーザーへの確認は `internal/app` で済ませ、結果だけを受け取ります。
- 返り値は domain の型です。ユーザーが対処できる失敗は package の sentinel error（`var ErrXxx = errors.New(...)`）で返し、`fmt.Errorf("...: %w", err)` で包んでも `errors.Is` で判定できるようにします。
- UI に表示する文言（日本語 / 英語）を持ちません。

### `internal/library`（store）

- SQLite への読み書きだけを行います。query は sqlc で生成し、条件の数が変わる検索のような動的な query だけ `database/sql` で手書きします（例: `segments.go` の `matchingSegments`）。
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

1. `internal/<feature>` に usecase、domain の型、sentinel error を書き、test する。
2. 永続化が必要なら `migrations/` に新しい連番の migration を追加し、`internal/library/queries` に query を書いて `go tool sqlc generate` する。
3. `internal/app` に bind する service と DTO を追加し、dialog、翻訳、DTO 変換を書く。service に `base` を埋め込む。
4. `main.go` で組み立て、`application.NewService` と `RegisterService` で登録する。
5. `go tool wails3 generate bindings -ts -i` で bindings を再生成し、`frontend/src/shared/api` の wrapper から呼ぶ。

## 技術スタックと注意点

- Desktop shell: Wails v3（macOS 13 以降）。Wails CLI と sqlc は `go.mod` の tool 依存で、`go tool` から実行します。
- Frontend: React 19 + TypeScript + Vite、pnpm。lint は oxlint、format は oxfmt、未使用コードの検出は knip。
- Backend: Go。lint と format は golangci-lint（`.golangci.yml`）。
- Store: SQLite（`glebarez/go-sqlite` = pure Go の modernc SQLite、`database/sql`）。schema 変更は `migrations/` に新しい連番ファイルを追加します。
- 検索: SQLite の FTS5（trigram tokenizer）。全文検索を強化する場合も、別の検索エンジンは入れず SQLite で行います。
- Code parsing（repo 接続時）: Tree-sitter。
- **sqlc の SQLite parser の制約:** FTS5 の `MATCH` は table 名ではなく列名に対して書き（`book_segments_fts.text MATCH ?`）、並び順は `bm25()` ではなく `rank` 列を使います。入れ子の subquery ではすべての table に alias を付けます。
- **EPUB の CSP:** foliate-js の iframe は WebKit の都合で `allow-scripts` が必要です。そのため EPUB 内の script は、本番ビルドの CSP（`frontend/vite.config.ts` の `script-src 'self'`）と、読み込み時の除去（`epubContent.ts` の `guardEpubContent`）で止めています。CSP を緩めないでください。dev server では CSP が効かないので、dev で動いても安全とは限りません。

## テスト

- Go の test は testify と `t.Context()` を使います（golangci-lint の `forbidigo` / `usetesting` で強制）。
- 機能 package: usecase を実物の SQLite（`t.TempDir()`）と生成した fixture で test し、domain の型と sentinel error（`assert.ErrorIs`）を確認します。
- `internal/app`: fake の dialog を使い、DTO への変換、asset URL の配信、エラーの翻訳、dialog のキャンセルや失敗の扱いを確認します。
- frontend: Vitest と Testing Library。test は対象ファイルの隣に `*.test.ts(x)` として置きます。
- copyrighted な本や private repo に依存する test は書かず、commit 可能な生成 PDF（`frontend/testdata`、`pnpm fixture:pdf`）と toy repo fixture を使います。
- repo 接続を実装する際は、file discovery と除外ルール、Tree-sitter による symbol 抽出、retrieval の結果の融合を重点的に test してください。

## プロダクト原則

- 読書優先: reader が主画面であり、他の機能は読書を補助する。
- ローカル優先: 本、index、読書状態、将来の repo index と mapping record はローカルに保存する。外部への通信はアップデート確認だけにする。
- 根拠優先: book-to-repo mapping の結果には、book location と repo path / symbol を必ず付ける。
- 説明可能な検索: なぜそのファイルや symbol が選ばれたかを表示する。
- LLM は後から足す層: retrieval は LLM なしで成立させる。LLM provider、embedding provider、vector store を UI や retrieval logic に直接結合しない。

## ロードマップ

1. ~~reader / library の基盤を整える（index 単位の `book_segments` への一般化、検索の FTS5 化）~~ 完了
2. ~~EPUB reader（閲覧、ハイライト、しおり、読み上げ）~~ 完了
3. local repository を 1つ接続し、repo files / symbols を index する。
4. `この章を自分のrepoで見る` を押すと、LLM なしで関連する repo files / symbols を、選ばれた理由とともに表示する。
5. 4 が LLM なしで成立した後に、book / repo citation 付きの説明生成を LLM の層として追加する。

## セキュリティ / プライバシー

- 本の内容はユーザーが提供した著作物として扱い、長い逐語引用を生成しないでください。
- repo を index する際は、`.env`、private key、credential file、dependency cache などを対象から除外してください。
- LLM を再導入する場合は、外部に送る内容をユーザーに明示し、送信前に redaction を行い、API key は OS の credential store に保存してください。
