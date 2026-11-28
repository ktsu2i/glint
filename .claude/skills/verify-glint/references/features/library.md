# Library

本棚の画面。本のインポート、並び替え、名前の変更、削除、表紙、続きから読む。

## サブ機能

- import：「Add Book」（空のときは「Choose Book」も）からファイルを選び、インポートしてすぐリーダーで開く
- recently-opened：最後に開いた本を「Recently opened」に出し、「Continue」で続きから開く
- book-card：「Imported books」の各カード。クリックで開く。進み具合（`2 / 3 pages` など）を出す
- sort：「Sort books: …」メニューで Recently Opened / Date Added / Title / Reading Progress を切り替える
- book-menu：カードの右クリックで開くメニュー。Rename、Choose File Again…（ファイルがないときだけ）、Remove from Library
- remove：確認ダイアログの後に削除する。ハイライト、ブックマーク、読書位置、本文の索引も一緒に消える
- cover：インポート後に PDF の 1 ページ目から表紙を作り、カードに出す

## ユーザーからの到達方法

アプリを起動すると最初に出る。リーダーからは左上の「Library」で戻る。

## ドライバでの操作

```bash
# インポート（成功）
node frontend/scripts/glint-driver.mjs dialog open-file frontend/testdata/generated-reader.pdf
node frontend/scripts/glint-driver.mjs click button "Add Book"
node frontend/scripts/glint-driver.mjs wait ".text-layer[data-page='1'] span"
node frontend/scripts/glint-driver.mjs dialog last          # open-file / Add a book to the library
node frontend/scripts/glint-driver.mjs sql "select title, format, page_count, cover_thumbnail_status from books"
node frontend/scripts/glint-driver.mjs sql "select count(*) from book_segments"

# インポートのキャンセル：答えを書かずに押す。本は増えない
node frontend/scripts/glint-driver.mjs click button "Add Book"

# 続きから読む
node frontend/scripts/glint-driver.mjs click button "Library"
node frontend/scripts/glint-driver.mjs click button "/Continue generated-reader/"

# 削除（キャンセルしてから、承認する）
node frontend/scripts/glint-driver.mjs right-click article
node frontend/scripts/glint-driver.mjs dialog confirm cancel
node frontend/scripts/glint-driver.mjs click menuitem "Remove from Library"
node frontend/scripts/glint-driver.mjs sql "select count(*) from books"        # 1 のまま
node frontend/scripts/glint-driver.mjs right-click article
node frontend/scripts/glint-driver.mjs dialog confirm accept
node frontend/scripts/glint-driver.mjs click menuitem "Remove from Library"
node frontend/scripts/glint-driver.mjs wait article detached
node frontend/scripts/glint-driver.mjs sql "select (select count(*) from books), (select count(*) from book_highlights), (select count(*) from book_bookmarks)"
```

並び替えは「Sort books: …」を押し、`snapshot` で項目名を確かめてから選ぶ。結果はカードの順番を `snapshot` で見る。

## 落とし穴

- インポートした本はデータディレクトリ（`home/Library/Application Support/Glint/books/<id>/`）にコピーされる。元のファイルを消しても「File not found」にはならない。ファイルがない状態を作るには、コピーの方を消す。
- 同じファイルをもう一度インポートすると、新しい本は増えず、既存の本が開く（`file_hash` が一意）。
- カードのメニューは右クリックで開く ContextMenu。`hover` しても出ない。
- 表紙と本文の索引は、本を開いた後に非同期で作られる。`cover_thumbnail_status` が `pending` のうちは結論を出さず、`ready` か `failed` になるまで待つ。
- `dialog last` は最後に出たダイアログしか覚えていない。確かめたい操作の直後に見る。
