# verify

[English](README.md)

Glint を実際に動かして、変更が効いていることを証拠付きで確かめるための skill。server モードでビルドした Glint を Playwright の WebKit で 1 手ずつ操作し、スクリーンショット、a11y tree、SQLite の行、再起動後の状態を証拠にする。

- `SKILL.md`：agent 向けの指示
- `references/features/`：feature map。何を操作し、何を確かめるかを機能ごとにまとめた一覧
- `cmd/verify`：ドライバ。`go tool verify` で実行する

## 準備

最初の 1 回だけ実行する。

```bash
(cd frontend && pnpm install --frozen-lockfile)
go tool verify install    # Playwright のドライバと WebKit をダウンロードする
```

ビルドは `start` が自動でする。

## 使い方

### agent に頼む

UI や保存される動作を変えたら、「verify skill で確かめて」と頼むか、Claude Code なら `/verify` を使う。AGENTS.md にも書いてあるので、頼まなくても agent が自分で使うことがある。Claude 以外の agent 向けに、`.agents/skills/verify` からこのディレクトリへ symlink を張ってある。

agent は、変更に関係する feature ファイルを読み、`start` と `doctor` を実行し、そこにある入口と経路を操作して証拠を集める。届かなかった経路は理由と一緒に報告し、最後に `stop` する。

頼み方の例：

- 「ハイライトの色変更を直したので、verify skill で再起動後まで確かめて」
- 「verify の feature map を上から全部回して、回帰がないか見て」
- 「verify の feature map に epub-reader を足して。手順は実際に動かして確かめて」

### 自分で動かす

リポジトリの中ならどのディレクトリからでも実行できる。本のファイルなど、渡した相対パスは今いるディレクトリから解決される。

```bash
go tool verify start          # ソースが新しければビルドしてから起動。空のライブラリから始まる
go tool verify doctor         # doctor: ok になっているか
go tool verify snapshot       # 今の画面の a11y tree。押せるボタンの名前が分かる

go tool verify dialog open-file frontend/testdata/generated-reader.pdf   # 次のファイル選択ダイアログの答え
go tool verify click button "Add Book"
go tool verify wait ".text-layer[data-page='1'] span"
go tool verify screenshot /tmp/reader.png
go tool verify sql "select title, page_count from books"

go tool verify restart-app    # 同じデータのままアプリだけを再起動
go tool verify stop           # 全部止めてデータを消す
```

`snapshot` で名前を見る、`click` で操作する、`wait` で結果を待つ、`screenshot` や `sql` で確かめる、の繰り返しになる。`go tool verify help` で全コマンドを見られる。

## 各コマンドで確かめられること

### 起動と環境

| コマンド | 確かめられること |
|---|---|
| `install` | 何も確かめない。Playwright のドライバと WebKit を最初に 1 回ダウンロードする |
| `start` | 今のソースからビルドでき、起動してマイグレーションが通り、空のライブラリが表示されること |
| `doctor` | 結果を信用してよい状態か：ビルドがソースより新しいか、ドライバやバイナリが起動後に変わっていないか、アプリが応答するか、使われていないダイアログの答えが残っていないか |
| `info` | 確かめた対象の URL、データベース、ログの場所（報告に添える） |
| `restart-app` | **アプリを再起動しても状態が残るか**：ハイライト、ブックマーク、読書位置、設定など。保存のし忘れ、起動時の読み込みの不具合、マイグレーションの問題が見つかる |
| `stop` | 何も確かめない。後片付け用 |

### 操作（ユーザーと同じ経路で動かす）

| コマンド | 確かめられること |
|---|---|
| `click <role> <name>` | ボタンやメニュー項目が、その名前で a11y に出ていて、押せること。押せなければタイムアウトになり、それ自体が失敗の証拠になる |
| `click-css` | role のない要素（カード、text layer など）を押したときの動き |
| `mouse-click` | 座標で判定する UI の動き（既存のハイライトを選ぶなど） |
| `right-click` | 右クリックで開くメニューの中身と動作 |
| `press` | キーボードショートカットとキー操作：ページ送り、綴じ方向による向きの逆転、Escape で閉じる、⌘F など |
| `type` | 入力欄の動き：ページ番号への移動、検索語の入力、名前の変更 |
| `select-text` | 本文が選べること（text layer が正しく重なっているか）。選ばれた文字列を出力する |
| `hover` | hover で出る UI：スライダーのプレビュー、ツールチップ |
| `--in-book` | 同じコマンドを EPUB の本文の中で使う：本文の選択、章の中の要素のクリック、章の DOM の確認（スクリプトが除去されたかなど） |
| `open` / `reload` | 特定の URL から始めたときや（設定画面は `/#settings`）、ページを読み直したときの動き。フロントエンドの状態だけが消え、アプリ側は動き続けている状態を作れる |
| `color-scheme <light\|dark>` | テーマが System のとき、OS の外観に従って切り替わること |

### 確認と証拠

| コマンド | 確かめられること | 限界 |
|---|---|---|
| `snapshot` | 画面の構造と状態：何が出ているか、ボタン名、`[pressed]` や `[disabled]`、一覧の項目数、パネルが開いているか。a11y の欠け（名前のないボタンなど）も見つかる | 色やレイアウトは分からない。EPUB の本文は `snapshot --in-book` で見る |
| `screenshot` | 見た目：ハイライトの色、ズーム、見開き、綴じ方向、崩れ | 目で見る必要がある |
| `wait <selector> [state]` | 非同期の結果が出ること、消えること（`detached`） | 時間内に出なければ失敗の証拠になる |
| `eval <expr>` | DOM の細かい値（今のページ番号の文字、選択範囲、属性など） | 読み取り専用。アプリの関数を直接呼んで操作の代わりにしない |
| `console` | 操作中に JS のエラーや警告が出ていないか | Wails、PDF.js、再起動後の WebSocket の警告は正常 |
| `sql <query>` | **保存されたデータが正しいか**：行ができたか、値（色、ページ、`rects` と `cfi` のどちらか一方だけ）、削除の連鎖、表紙や索引の状態 | 読み取り専用 |
| `logs` | Go 側のエラー：binding の失敗、パースエラーなど | |

### ダイアログ

| コマンド | 確かめられること |
|---|---|
| `dialog open-file <path>` | ファイル選択の成功経路：インポート、ファイルの選び直し |
| （答えを書かずに操作） | キャンセルの経路：何も変わらないこと |
| `dialog confirm accept / cancel` | 確認の承認とキャンセルの両方：削除されること、されないこと |
| `dialog last` | **ダイアログが実際に出たか**と、その種類とタイトル。出るべきでない場面で出ていないかも分かる |

### 組み合わせ

1 つのコマンドだけでは証拠として弱いので、組み合わせて使う。

- **保存の確認**：操作 → `sql` で行を見る → `restart-app` → 画面で残っているか見る。例：ハイライトが DB に保存され、再起動後も描画される
- **削除の確認**：`dialog confirm cancel` → 何も変わらない → `accept` → `sql` で関連する行も消えたか見る
- **キー操作の確認**：`press` → `eval` で今のページを読む → 綴じ方向を変えてもう一度
- **非同期処理の確認**：インポート → `wait` → `sql` で `cover_thumbnail_status` が `ready`、`book_segments` の件数がページ数と同じ
- **エラーが出ていないことの確認**：一連の操作の後に `console` と `logs`

## 確かめられないこと

- ネイティブの部分：ウィンドウ、タイトルバー、全画面、メニューバー、設定ウィンドウを開く操作とウィンドウ間のリアルタイムな反映（設定画面そのものは `/#settings` で開ける）、Finder からのドラッグ&ドロップ、Sparkle、読み上げの音声
- WKWebView だけで起きる違い（Playwright の WebKit は近いが同じではない）
- 性能の数字（同じ条件で測る仕組みがまだない）
- 行をまたぐテキスト選択（`select-text` は 1 つの要素の中だけを選ぶ）

変更がこれらに関わるときは gap として報告し、`go tool wails3 dev` で実際のアプリを見て確かめる。

## 気をつけること

- 普段のライブラリには触れない。データは `$TMPDIR/glint-verify-…` に作られ、`stop` で消える。
- ネイティブのダイアログは出ない。操作の前に `dialog open-file <path>` や `dialog confirm accept|cancel` で答えを書いておく。答えがなければキャンセル扱いになる。
- コードを変えたら `stop` してから `start` し直す。古いまま動かしていると `doctor` が `STALE BUILD` や `STALE DRIVER` を出す。
- テスト用の本は `frontend/testdata` の生成済みの本（`generated-reader.pdf`、`generated-reader.epub`）を使う。手元の本で試す場合も、その結果を feature map やテストに書かない。

## feature map の育て方

- 機能を足したり UI を変えたりしたら、同じ PR で該当する feature ファイルも直す。英語で書き、4 つの見出しを揃える。
- まだないファイル（read-aloud、journeys）は、その機能を確かめる必要が出たときに足す。
