import "./pdfPolyfills";
import "pdfjs-dist/build/pdf.worker.min.mjs";
import type { PDFDocumentLoadingTask, PageViewport, PDFPageProxy } from "pdfjs-dist";

type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

export type PdfTextLayer = {
  render: () => Promise<void>;
  cancel: () => void;
};

function hasPdfHeader(data: Uint8Array): boolean {
  return pdfHeader.every((byte, index) => data[index] === byte);
}

function resolveAssetUrl(path: string): string {
  const base = typeof document !== "undefined" ? document.baseURI : "http://localhost/";
  return new URL(path, base).toString();
}

export async function createPdfLoadingTask(
  url: string,
  signal: AbortSignal,
): Promise<PDFDocumentLoadingTask> {
  const [response, pdfjs] = await Promise.all([
    fetch(url, { cache: "no-store", signal }),
    import("pdfjs-dist"),
  ]);

  if (!response.ok) {
    throw new Error(`PDFファイルを取得できませんでした（HTTP ${response.status}）。`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  if (!hasPdfHeader(data)) {
    throw new Error("取得したデータがPDFではありません。アプリを再起動して、もう一度開いてください。");
  }

  return pdfjs.getDocument({
    data,
    cMapUrl: resolveAssetUrl("pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: resolveAssetUrl("pdfjs/standard_fonts/"),
  });
}

export async function createPdfTextLayer(params: {
  textContentSource: TextContent | ReadableStream;
  container: HTMLElement;
  viewport: PageViewport;
}): Promise<PdfTextLayer> {
  const pdfjs = await import("pdfjs-dist");
  return new pdfjs.TextLayer(params);
}
