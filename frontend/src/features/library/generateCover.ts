import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { createPdfLoadingTask } from "../reader/loadPdf";

const coverWidth = 320;

export async function generateCoverThumbnail(url: string): Promise<string> {
  const abortController = new AbortController();
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let renderTask: RenderTask | undefined;
  try {
    loadingTask = await createPdfLoadingTask(url, abortController.signal);
    const pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(1);
    const naturalViewport = page.getViewport({ scale: 1 });
    if (!Number.isFinite(naturalViewport.width) || naturalViewport.width <= 0) {
      throw new Error("表紙サイズを取得できませんでした。");
    }
    const outputScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const viewport = page.getViewport({
      scale: (coverWidth / naturalViewport.width) * outputScale,
    });
    const canvas = globalThis.document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("表紙画像を作成できませんでした。");
    }
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    renderTask = page.render({ canvas, canvasContext: context, viewport });
    await renderTask.promise;
    return canvas.toDataURL("image/png");
  } finally {
    abortController.abort();
    renderTask?.cancel();
    await loadingTask?.destroy();
  }
}
