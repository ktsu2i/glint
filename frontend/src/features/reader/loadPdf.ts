import "./pdfPolyfills";
import "pdfjs-dist/build/pdf.worker.min.mjs";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function hasPdfHeader(data: Uint8Array): boolean {
  return pdfHeader.every((byte, index) => data[index] === byte);
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

  return pdfjs.getDocument({ data });
}
