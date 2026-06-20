# AGENTS.md

このリポジトリで作業するエージェント向けのガイドです。作業前にこのファイルと `docs/` 配下の設計ドキュメントを確認してください。

## プロジェクト概要

Glint は、技術書 PDF とローカルリポジトリの両方にインデックスを張り、読書中の章・節・コードブロック・概念をユーザー自身のコードベースに接続して理解できるデスクトップアプリです。

目指す体験は「技術書読書専用 Cursor」です。ただし、中心はチャットではなく読書です。

コア構造:

```text
技術書PDF Index
+
Local Repo Index
+
Book <-> Repo Mapping
+
Context Builder
+
LLM Gateway
```

## 主要ドキュメント

- `docs/product-requirements.md`: プロダクト要件、MVP、UX、非技術要件。
- `docs/technical-design.md`: 技術選定、アーキテクチャ、データモデル、検索、LLM gateway。
- `docs/initial-implementation-plan.md`: 初期実装マイルストーン、受け入れ基準、実装順序。

実装判断に迷った場合は、まずこの3ファイルの意図に合わせてください。

## 作業方針

- 日本語でコミュニケーションしてください。
- 実装より前に、既存の設計ドキュメントと現在のファイル構成を確認してください。
- ユーザーから明示的に変更依頼がある場合は、提案だけで止まらず実装まで進めてください。
- 不要な抽象化や大きなリファクタリングは避け、現在のマイルストーンに必要な範囲に絞ってください。
- 技術用語、API 名、型名、ファイル名、識別子は英語のままで構いません。
- ユーザーが作った可能性のある変更は勝手に戻さないでください。

## プロダクト原則

- 読書優先: PDF reader が主画面であり、AI は読書体験を補助する。
- 根拠優先: 重要な回答には book location と repo path / symbol evidence を付ける。
- ローカル優先: PDF、repo index、mapping record はデフォルトでローカル保存する。
- 明示的な共有: 外部 LLM に送る内容はユーザーに分かるようにする。
- 説明可能な検索: なぜそのファイルや symbol が選ばれたかを表示する。
- context budget 意識: chapter や repo 全体をそのまま prompt に入れない。

## 技術方針

現時点の推奨スタック:

- Desktop shell: Wails v2
- Frontend: React + TypeScript + Vite
- Backend: Go
- PDF 表示 / 抽出: PDF.js
- Metadata store: SQLite
- Lexical search: Bleve
- Semantic search: 初期 vertical slice では deferred。provider-neutral な interface を先に定義する。
- Code parsing: Tree-sitter
- LLM: provider-neutral な gateway を経由する。

LLM provider、embedding provider、vector store を UI や retrieval logic に直接結合しないでください。

## 初期実装の優先順位

最初に作るべき runnable prototype:

1. 検索可能な技術書 PDF を 1つ import する。
2. PDF を desktop app 上で読めるようにする。
3. 右側 sidebar で AI とチャットできるようにする。
4. selected text または current page text を明示的に chat context として渡せるようにする。
5. LLM provider 設定と streaming answer UI を作る。

その後に作る Product MVP:

1. local repository を 1つ接続する。
2. book chunks と repo chunks / symbols を index する。
3. `この章を自分のrepoで見る` を押せるようにする。
4. LLM なしで関連 repo files / symbols を表示する。
5. LLM 設定がある場合だけ、book / repo citation 付きの説明を生成する。

初期の AI chat sidebar は土台として作りますが、最終価値を generic AI chat に寄せないでください。Glint の中核は book-to-repo mapping です。

## セキュリティ / プライバシー

- `.env`、private key、credential file、dependency cache などは index しないでください。
- 外部 LLM call 前に redaction を行う前提で設計してください。
- API key は OS credential store または同等の encrypted local mechanism に保存する方針です。
- prompt logging は default off とし、保存する場合も local かつ clear 可能にしてください。
- book content はユーザー提供の copyrighted material として扱い、長い逐語引用を生成しないでください。

## テスト方針

初期から重視するテスト:

- repo file discovery と exclude rules
- secret redaction
- PDF chunk normalization
- code block detection
- Tree-sitter symbol extraction
- retrieval fusion
- context budget trimming

copyrighted books や private repos に依存するテストは避け、commit 可能な generated PDF と toy repo fixture を使ってください。

## ファイル編集ルール

- Markdown ドキュメントは日本語で書いてください。
- コードや設定ファイルは既存の style に合わせてください。
- 生成物、依存ディレクトリ、秘密情報を commit 対象にしないでください。
- 大きな設計変更を行う場合は、実装と同時に `docs/` の該当ドキュメントも更新してください。
