# Highlights

本文を選んで色を付けるハイライト。PDF ではページ上の矩形（`rects`）で、EPUB では CFI で位置を持つ。

## サブ機能

- create：本文を選ぶと「Highlight the selection」のツールバーが出て、「Highlight in yellow / green / pink / purple」で作る
- activate：既存のハイライトをクリックすると「Highlight」のツールバーが出る
- change-color：「Change to <color>」で色を変える
- remove：ツールバーの「Remove highlight」、または一覧の「Remove the highlight on page N」で消す
- list：「Open highlights」で一覧を開き、「Go to the highlight on page N」で移動する
- persistence：開き直しても、アプリを再起動しても残る

## ユーザーからの到達方法

リーダーで本文をドラッグして選ぶ。一覧は上のバーの「Open highlights」から開く。

## ドライバでの操作

```bash
# 作成
node frontend/scripts/glint-driver.mjs select-text ".text-layer[data-page='1'] span"   # 選んだ文字列を出す
node frontend/scripts/glint-driver.mjs click button "Highlight in yellow"
node frontend/scripts/glint-driver.mjs wait ".highlight-mark.is-yellow"
node frontend/scripts/glint-driver.mjs sql "select page_number, color, text, cfi = '' as is_pdf, rects <> '' as has_rects from book_highlights"

# 色の変更
node frontend/scripts/glint-driver.mjs mouse-click ".highlight-mark.is-yellow"
node frontend/scripts/glint-driver.mjs click button "Change to pink"
node frontend/scripts/glint-driver.mjs wait ".highlight-mark.is-pink"

# 一覧
node frontend/scripts/glint-driver.mjs click button "Open highlights"
node frontend/scripts/glint-driver.mjs snapshot          # complementary "Highlights" の中の listitem
node frontend/scripts/glint-driver.mjs click button "Go to the highlight on page 1"

# 永続化
node frontend/scripts/glint-driver.mjs restart-app
node frontend/scripts/glint-driver.mjs click button "/Continue generated-reader/"
node frontend/scripts/glint-driver.mjs wait ".highlight-mark.is-pink"
```

## 落とし穴

- `.highlight-mark` は text layer の下にあり、`click-css` だと text layer にクリックを取られる。既存のハイライトを選ぶときは `mouse-click` を使う（アプリはクリックした座標からハイライトを探す）。
- `select-text` は要素の左端から右端までドラッグする。行をまたぐ選択はまだドライバにない。
- PDF のハイライトは `rects` を持ち `cfi` は空、EPUB はその逆。どちらか一方だけが入っていることを `sql` で確かめる。
- 色はユーザーに見える証拠なので、`sql` に加えて `screenshot` も残す。
