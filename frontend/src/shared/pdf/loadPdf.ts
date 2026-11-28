import "./pdfPolyfills";
import type * as Pdfjs from "pdfjs-dist";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PageViewport,
  PDFPageProxy,
} from "pdfjs-dist";
import { LocalizedError } from "../i18n/error";
import { normalizePageText } from "../lib/text";

type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

export type OutlineNode = {
  title: string;
  pageNumber: number | null;
  children: OutlineNode[];
};

export type ExtractedPdfPage = {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
};

export async function extractPdfPage(
  document: PDFDocumentProxy,
  pageNumber: number,
): Promise<ExtractedPdfPage> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) {
    throw new Error("PDF page is outside the document");
  }
  const page = await document.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  return {
    pageNumber,
    text: normalizePageText(
      textContent.items
        .filter((item) => "str" in item)
        .map((item) => ({ str: item.str, hasEOL: item.hasEOL })),
    ),
    width: viewport.width,
    height: viewport.height,
  };
}

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

// PDF.js runs its worker on the main thread (the bundled WebKit needs the
// polyfills above), so the worker module is loaded with PDF.js itself rather
// than in the app's entry chunk. It must be evaluated before a document opens.
let pdfjsPromise: Promise<typeof Pdfjs> | undefined;

function loadPdfjs(): Promise<typeof Pdfjs> {
  pdfjsPromise ??= import("pdfjs-dist/build/pdf.worker.min.mjs")
    .then(() => import("pdfjs-dist"))
    .catch((error: unknown) => {
      pdfjsPromise = undefined;
      throw error;
    });
  return pdfjsPromise;
}

function hasPdfHeader(data: Uint8Array): boolean {
  return pdfHeader.every((byte, index) => data[index] === byte);
}

function resolveAssetUrl(path: string): string {
  const base = typeof document === "undefined" ? "http://localhost/" : document.baseURI;
  return new URL(path, base).toString();
}

export async function createPdfLoadingTask(
  url: string,
  signal: AbortSignal,
): Promise<PDFDocumentLoadingTask> {
  const [response, pdfjs] = await Promise.all([
    fetch(url, { cache: "no-store", signal }),
    loadPdfjs(),
  ]);

  if (!response.ok) {
    throw new LocalizedError("error.fetchPdf", { status: response.status });
  }

  const data = new Uint8Array(await response.arrayBuffer());
  if (!hasPdfHeader(data)) {
    throw new LocalizedError("error.invalidPdf");
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
  const pdfjs = await loadPdfjs();
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

function isPageRef(value: unknown): value is { num: number; gen: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "num" in value &&
    typeof value.num === "number" &&
    "gen" in value &&
    typeof value.gen === "number"
  );
}

async function resolveDestinationPage(
  document: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined,
): Promise<number | null> {
  if (dest === null || dest === undefined || dest === "") {
    return null;
  }
  try {
    const explicit = typeof dest === "string" ? await document.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) {
      return null;
    }
    const ref: unknown = explicit[0];
    if (!isPageRef(ref)) {
      return null;
    }
    const index = await document.getPageIndex(ref);
    return index + 1;
  } catch {
    return null;
  }
}
