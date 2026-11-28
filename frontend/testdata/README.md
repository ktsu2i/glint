# テスト用fixture

`generated-reader.pdf`は、PDF readerの検証に使うcommit可能なPDFです。
2つのsection、説明文、code block、page number、outlineを含みます。

`generated-reader.epub`は、EPUB readerの検証に使うcommit可能なEPUBです。
表紙、目次（nav）、複数ページにまたがる3つの章を含みます。
第2章には、readerが取り除くべきactive content（`<script>`、`onclick`、`javascript:`のlink）をわざと入れています。

`generated-reader-drm.epub`は、同じ本に`META-INF/encryption.xml`を加えたEPUBです。DRM保護されたEPUBとして取り込みを拒否されることの検証に使います。

内容を再生成する場合は次を実行します。

```bash
cd frontend
pnpm fixture:pdf
pnpm fixture:epub
```
