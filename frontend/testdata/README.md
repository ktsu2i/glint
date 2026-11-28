# Test fixtures

`generated-reader.pdf` is a committable PDF for testing the PDF reader.
It has two sections, body text, a code block, page numbers, and an outline.

`generated-reader.epub` is a committable EPUB for testing the EPUB reader.
It has a cover, a table of contents (nav), and three chapters that span several pages.
Chapter 2 deliberately contains active content the reader must strip: a `<script>`, an `onclick` handler, and a `javascript:` link.

`generated-reader-drm.epub` is the same book with a `META-INF/encryption.xml` added. It is used to check that importing a DRM-protected EPUB is refused.

To regenerate them, run:

```bash
cd frontend
pnpm fixture:pdf
pnpm fixture:epub
```
