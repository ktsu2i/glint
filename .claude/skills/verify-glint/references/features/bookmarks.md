# Bookmarks

ページを保存して後で戻る機能。PDF はページ番号で、EPUB はページ先頭の CFI と本全体での位置（`progress`）で保存する。

## サブ機能

- save：上のバーの「Save page N」で今のページを保存する
- unsave：保存済みのページでは同じボタンが「Remove bookmark from page N」になり、押すと解除する
- list：「Open bookmarks」で一覧を開き、「Go to bookmarked page N」で移動する
- slider-mark：保存したページはスライダー上にも印が出る（「Go to page N, bookmarked」）
- persistence：開き直しても、アプリを再起動しても残る

## ユーザーからの到達方法

リーダーの上のバーの右側にあるブックマークのボタン。一覧は左側の「Open bookmarks」から開く。

## ドライバでの操作

```bash
node frontend/scripts/glint-driver.mjs press ArrowRight
node frontend/scripts/glint-driver.mjs click button "Save page 2"
node frontend/scripts/glint-driver.mjs sql "select page_number, cfi, progress from book_bookmarks"     # 2||0.0
node frontend/scripts/glint-driver.mjs snapshot          # ボタンが "Remove bookmark from page 2" に変わる

# 一覧から移動
node frontend/scripts/glint-driver.mjs press ArrowLeft
node frontend/scripts/glint-driver.mjs click button "Open bookmarks"
node frontend/scripts/glint-driver.mjs click button "Go to bookmarked page 2"

# 解除
node frontend/scripts/glint-driver.mjs click button "Remove bookmark from page 2"
node frontend/scripts/glint-driver.mjs sql "select count(*) from book_bookmarks"

# 永続化
node frontend/scripts/glint-driver.mjs restart-app
node frontend/scripts/glint-driver.mjs click button "/Continue generated-reader/"
node frontend/scripts/glint-driver.mjs click button "Open bookmarks"
node frontend/scripts/glint-driver.mjs snapshot
```

## 落とし穴

- ボタンの名前はページ番号を含むので、ページを移動すると変わる。押す前に `snapshot` で今の名前を見る。
- 一覧を開いていると「Remove bookmark from page N」が上のバーと一覧の両方にある。`click` は最初に見つかった上のバーの方を押す。
- 矢印キーの向きは綴じ方向で変わる（[pdf-reader](pdf-reader.md)）。上の手順は左綴じ（初期値）が前提。
- PDF のブックマークは `cfi` が空で `progress` は 0。EPUB は `cfi` と `progress` が入る。
- 一覧のパネルは開いたままになる。別のパネルを確かめる前に「Close panel」で閉じる。
