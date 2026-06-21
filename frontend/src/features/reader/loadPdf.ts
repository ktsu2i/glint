import "./pdfPolyfills";
import "pdfjs-dist/build/pdf.worker.min.mjs";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PageViewport,
  PDFPageProxy,
} from "pdfjs-dist";

type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

export type OutlineNode = {
  title: string;
  pageNumber: number | null;
  children: OutlineNode[];
};

type RawOutlineItem = {
  title: string;
  dest?: string | unknown[] | null;
  items?: RawOutlineItem[];
};

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

export async function loadPdfOutline(document: PDFDocumentProxy): Promise<OutlineNode[]> {
  const outline = (await document.getOutline()) as RawOutlineItem[] | null;
  if (!outline || outline.length === 0) {
    return [];
  }
  return Promise.all(outline.map((item) => normalizeOutlineItem(document, item)));
}

async function normalizeOutlineItem(
  document: PDFDocumentProxy,
  item: RawOutlineItem,
): Promise<OutlineNode> {
  const [pageNumber, children] = await Promise.all([
    resolveDestinationPage(document, item.dest),
    Promise.all((item.items ?? []).map((child) => normalizeOutlineItem(document, child))),
  ]);
  return { title: item.title, pageNumber, children };
}

async function resolveDestinationPage(
  document: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined,
): Promise<number | null> {
  if (!dest) {
    return null;
  }
  try {
    const explicit = typeof dest === "string" ? await document.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) {
      return null;
    }
    const ref = explicit[0] as { num: number; gen: number };
    const index = await document.getPageIndex(ref);
    return index + 1;
  } catch {
    return null;
  }
}
