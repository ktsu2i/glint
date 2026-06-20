# Glint

Glint は、技術書PDFを読みながら、その内容を自分のコードベースへ接続して理解するためのdesktop appです。現在は最初のvertical sliceとして、PDF readerとmock AI chat sidebarを実装しています。

## 現在できること

- native file dialogから検索可能なPDFを開く
- PDF.jsでページを表示する
- 前後ページ移動とzoom
- current page textの抽出と送信前preview
- current page textを明示的に含める／含めないchat操作
- Goのprovider-neutral gatewayを通したmock streaming answer
- token付きlocal endpointによるPDF配信。frontendへlocal pathは渡さない

実LLM provider、API key保存、読書位置の永続化、repo indexing、book-to-repo mappingはまだ含みません。

## 技術構成

- Wails v2.12.0
- Go
- React 19 + TypeScript + Vite
- PDF.js

## 必要な環境

- Go 1.23以上
- Node.js 20.19以上、または22.12以上
- Wails CLI v2.12.0

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
```

OSごとの追加要件は[Wails installation guide](https://wails.io/docs/gettingstarted/installation)を確認してください。

## 開発起動

```bash
cd frontend
npm ci
cd ..
wails dev
```

## Test

```bash
go test ./...
cd frontend
npm test
npm run build
```

## Production build

```bash
wails build
```

macOSでは`build/bin/glint.app`が生成されます。
