---
name: verify-glint
description: "Glint を実際に動かして、変更が効いていることを証拠付きで確かめる。server モードのビルドを WebKit で操作し、a11y tree、スクリーンショット、SQLite の行、再起動後の状態を証拠にする。UI や永続化に関わる変更を確かめるとき、スクリーンショットや画面操作が要るとき、広い回帰確認をするときに使う。"
---

# Verify Glint

Glint を `-tags 'server verify'` でビルドし、Playwright の WebKit で 1 手ずつ操作する。ユニットテストでは見えない、画面、Wails の境界、SQLite、再起動の組み合わせを確かめるためのもの。

ドライバは `node frontend/scripts/glint-driver.mjs <command>` で、リポジトリのルートから実行する。`help` の出力が正しいコマンド一覧になる。

## 仕組み

- アプリは GUI なしの HTTP サーバとして動き、WebKit のページがそこにつながる。本番と同じ `frontend/dist` を配るので、本番の CSP も効く。
- `HOME` を一時ディレクトリに向けて起動する。データベースも本のコピーもそこにでき、普段使っているライブラリには触れない。`stop` で消える。
- ネイティブのダイアログは出ない。`verify` タグのビルドでは、`dialog` コマンドで先に書いた答えを読む（`internal/app/dialogs_verify.go`）。答えは 1 回で消え、答えがなければキャンセル扱いになる。
- host プロセスがアプリとページを持ち続けるので、コマンドの間でページの状態が残る。
- 状態は `$TMPDIR/glint-verify-<リポジトリのパスのハッシュ>` に置く。worktree ごとに別のインスタンスになる。

## クイックスタート

```bash
node frontend/scripts/glint-driver.mjs start      # ソースが新しければビルドしてから起動
node frontend/scripts/glint-driver.mjs doctor     # 必ず確かめる
node frontend/scripts/glint-driver.mjs snapshot   # 今の画面の a11y tree

node frontend/scripts/glint-driver.mjs dialog open-file frontend/testdata/generated-reader.pdf
node frontend/scripts/glint-driver.mjs click button "Add Book"
node frontend/scripts/glint-driver.mjs wait ".text-layer[data-page='1'] span"
node frontend/scripts/glint-driver.mjs screenshot /path/to/proof.png

node frontend/scripts/glint-driver.mjs stop
```

## コマンドの分類

- 起動と後片付け：`build`、`start`、`stop`、`doctor`、`info`、`restart-app`
- 移動と入力：`open`、`reload`、`click`、`click-css`、`mouse-click`、`right-click`、`press`、`type`、`select-text`、`hover`
- 確認と証拠：`snapshot`、`screenshot`、`wait`、`eval`、`console`、`sql`、`logs`
- ダイアログ：`dialog open-file <path>`、`dialog confirm <accept|cancel>`、`dialog last`

## 証拠の基準

「開いた」「表示された」だけの証拠は出さない。疑い深いレビュアーが納得する、ユーザーと同じ経路での結果を示す。

- 最初に `doctor` を実行する。`STALE BUILD`、`STALE DRIVER`、`STALE INSTANCE`、使われていないダイアログの答えが出たら、直してから進める。古いビルドでの結果は証拠にならない。
- `references/features/` から変更に関係するファイルを読み、そこにある入口、モード、成功、キャンセル、エラー、空、永続化の経路のうち、変更が影響しうるものを全部通す。
- 操作はユーザーと同じ経路で行う。ボタン、キー、メニュー、ダイアログを使う。`eval` は操作の後に状態を読むためだけに使い、アプリの関数を直接呼んで操作の代わりにしない。
- 画面だけでなく副作用も確かめる。`sql` で行を見る、`dialog last` でダイアログが出たことを見る、`restart-app` の後も残っていることを見る。
- 操作のきっかけと、落ち着いた後の最終状態を、同じ流れの中で記録する。
- 届かない経路は、名前と理由（native UI、OS、ドライバの制約）を書き、確かめられた一番近い経路を示す。

## 操作の決まり

- 要素は ARIA の role と名前で探す（`click button "Add Book"`）。CSS セレクタは、role のない要素（`.text-layer`、`.highlight-mark` など）にだけ使う。
- 名前が本のタイトルなどで変わるときは `/正規表現/` で指定する（`click button "/Continue generated-reader/"`）。
- 固定の待ち時間で待たない。`wait` で、目に見える最終状態を待つ。
- ページ送りなどは、座標クリックより登録されたキー（`press ArrowRight`）を優先する。
- テスト用の本は `frontend/testdata/generated-reader.pdf`（3 ページ、目次付き）を使う。著作権のある本や個人の本を使わない。
- ドライバや Go のコードを変えたら、`stop` してから `start` し直す。
- `console` に出る次のメッセージは正常：Wails の「Browser Environment Detected」、PDF.js の「Setting up fake worker」、`restart-app` の後の WebSocket の切断と再接続。

## 届かないもの

次はこのドライバでは確かめられない。必要なら gap として明記する。

- ネイティブのウィンドウ：タイトルバー、全画面、ウィンドウの位置と大きさの記憶、アプリケーションメニュー
- 設定ウィンドウ：別ウィンドウとして開くため、未確認
- Finder からのドラッグ&ドロップ
- Sparkle の更新
- 読み上げの音声そのもの（ボタンの状態は確かめられる）
- WKWebView 固有の違い。Playwright の WebKit は近いが同じではない。描画やフォーカスの細かい違いが疑わしいときは、実機（`go tool wails3 dev`）でも見る。

## Feature map

振る舞いの一覧は [`references/features/`](references/features/README.md) にある。1 機能 1 ファイルで、どれも「サブ機能 / ユーザーからの到達方法 / ドライバでの操作 / 落とし穴」の 4 つの見出しを持つ。広い回帰確認では、README の順に上から回す。
