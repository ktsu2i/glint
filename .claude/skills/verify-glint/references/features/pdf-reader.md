# PDF reader

PDF.js で PDF を表示するリーダー。ページ送り、ページ番号への移動、スライダー、表示の設定、読書位置の復元。

## サブ機能

- page-turn：「Previous page」「Next page」、矢印キー、PageUp / PageDown
- go-to-page：下のバーの「Go to page」を押すと「Page number」の入力欄になり、番号を入れて Enter で移動する
- page-slider：「Page slider」でページを選ぶ。hover でページ番号とプレビューを出す
- toc：「Open table of contents」で目次を開き、項目から移動する
- view-menu：「View」で綴じ方向（Left binding / Right binding）とズーム（Zoom out / Zoom in / Fit page）を切り替える
- reading-position：開いているページを保存し、次に開いたときにそのページから始める
- text-layer：PDF.js の text layer。選択（ハイライト）と本文検索の土台になる

## ユーザーからの到達方法

ライブラリでカードか「Continue」を押す。インポート直後も自動で開く。

## ドライバでの操作

```bash
node frontend/scripts/glint-driver.mjs wait ".text-layer[data-page='1'] span"
node frontend/scripts/glint-driver.mjs press ArrowRight
node frontend/scripts/glint-driver.mjs eval "document.querySelector('[aria-label=\"Go to page\"]')?.textContent"   # "2 / 3"

# ページ番号で移動
node frontend/scripts/glint-driver.mjs click button "Go to page"
node frontend/scripts/glint-driver.mjs click-css "input[aria-label='Page number']"
node frontend/scripts/glint-driver.mjs press Meta+A
node frontend/scripts/glint-driver.mjs type 3
node frontend/scripts/glint-driver.mjs press Enter

# 綴じ方向を右にすると、矢印キーの向きが逆になる
node frontend/scripts/glint-driver.mjs click button "View"
node frontend/scripts/glint-driver.mjs click button "Right binding"
node frontend/scripts/glint-driver.mjs press Escape
node frontend/scripts/glint-driver.mjs sql "select page_number, binding_direction from book_reading_states"

# 読書位置の復元
node frontend/scripts/glint-driver.mjs restart-app
node frontend/scripts/glint-driver.mjs click button "/Continue generated-reader/"
node frontend/scripts/glint-driver.mjs eval "document.querySelector('[aria-label=\"Go to page\"]')?.textContent"
```

表示が変わる操作（ズーム、見開き、綴じ方向）は `screenshot` も残す。

## 落とし穴

- 「Setting up fake worker」の警告は正常。PDF.js の worker はわざとメインスレッドで動かしている（`frontend/src/shared/pdf/loadPdf.ts`）。
- text layer は描画の後に作られる。`.text-layer[data-page='N'] span` を待ってから選択や検索をする。
- 綴じ方向が右のときは ArrowLeft が「次」になる。キーで確かめるときは今の綴じ方向を先に見る。
- 現在のページは下のバーの「Go to page」の文字（`N / 3`）か、上のタイトルの下の文字で読む。
- 読書位置の保存は非同期。`restart-app` の前に `sql` で `book_reading_states` が更新されたことを見る。
