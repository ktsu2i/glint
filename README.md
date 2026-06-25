# Glint

Glint は、技術書PDFを読みながら、その内容を自分のコードベースへ接続して理解するためのdesktop appです。現在は最初のvertical sliceとして、local library、PDF reader、複数provider対応のAI chat sidebarを実装しています。

## 現在できること

- native file dialogから検索可能なPDFを本棚へimportする
- import済みPDFをSQLiteに保存し、再起動後も表紙cardで一覧する
- PDF先頭ページのlocal thumbnail生成とplaceholder cover
- 本棚からreaderを開き、前回の読書ページから再開する
- source PDFが移動・削除された場合の再選択導線
- PDF.jsでページを表示する
- 前後ページ移動とzoom
- current page textの抽出と送信前preview
- current page textを明示的に含める／含めないchat操作
- PDFを開いたままpage textをbackgroundでlocal indexへ保存する
- `⌘F` / `Ctrl+F`またはReader toolbarから1冊内を全文検索し、結果pageへ移動する
- Goのprovider-neutral gatewayを通したstreaming answer
- OpenRouter / OpenAI / Anthropic / Google Gemini / Ollama / OpenAI互換endpointの設定UI
- 保存済みprovider設定の接続テスト
- light / dark / system theme切替と、選択内容のlocal保存
- API keyのOS credential store保存。SQLiteにはmodelとprivacy設定だけを保存
- token付きlocal endpointによるPDF配信。frontendへlocal pathは渡さない

section / chunk抽出、Library横断検索、repo indexing、book-to-repo mappingはまだ含みません。

## LLM provider設定

1. Reader右上の`設定する`を開く。
2. 利用するproviderを選ぶ。
3. providerのmodel IDと、必要な場合はAPI keyを入力する。
4. provider固有optionを確認して設定を保存する。
5. `接続をテスト`でcredential、endpoint、modelを確認する。

API keyはproviderごとにOS credential storeへ保存し、通常のSQLite rowには保存しません。OpenRouterの`Zero Data Retention`はdefaultで有効です。有効時はOpenRouter requestに`provider.zdr = true`を指定し、ZDR endpointだけにroutingを制限します。

質問とユーザーが明示的に添付したPDF textは、選択したproviderまたはユーザー指定endpointへ送信されます。providerが未設定でもLibraryとPDF readerは利用できます。

## 技術構成

- Wails v2.12.0
- Go
- React 19 + TypeScript + Vite
- PDF.js
- SQLite（modernc.org/sqlite）

## 必要な環境

- Go 1.23以上
- Node.js 20.19以上、または22.12以上
- pnpm 10.30.2
- Wails CLI v2.12.0

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
```

OSごとの追加要件は[Wails installation guide](https://wails.io/docs/gettingstarted/installation)を確認してください。

frontendのpackage managerはpnpm 10.30.2に固定しています。`npm install`と`npm run`は`package.json`のguardにより失敗します。

## 開発起動

```bash
cd frontend
pnpm install --frozen-lockfile
cd ..
wails dev
```

## Test

```bash
go test ./...
cd frontend
pnpm test
pnpm run build
```

## Production build

```bash
wails build
```

macOSでは`build/bin/glint.app`が生成されます。
