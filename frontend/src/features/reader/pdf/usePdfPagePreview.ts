import { useEffect, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

export const previewWidth = 112;
const cacheLimit = 40;
const renderDelayMilliseconds = 60;

export type PreviewCache = Map<number, HTMLCanvasElement>;

// PdfReader remounts per book, so one cache per mount never mixes documents.
export function usePdfPreviewCache(): PreviewCache {
  const [cache] = useState<PreviewCache>(() => new Map());
  return cache;
}

function remember(cache: PreviewCache, pageNumber: number, canvas: HTMLCanvasElement) {
  cache.delete(pageNumber);
  cache.set(pageNumber, canvas);
  while (cache.size > cacheLimit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

async function renderPreview(
  document: PDFDocumentProxy,
  pageNumber: number,
  onTask: (task: RenderTask) => void,
): Promise<HTMLCanvasElement | null> {
  const page = await document.getPage(pageNumber);
  const natural = page.getViewport({ scale: 1 });
  if (!Number.isFinite(natural.width) || natural.width <= 0) {
    return null;
  }
  const outputScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const viewport = page.getViewport({ scale: (previewWidth / natural.width) * outputScale });
  const canvas = globalThis.document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const task = page.render({ canvas, canvasContext: context, viewport });
  onTask(task);
  await task.promise;
  return canvas;
}

// Returns a small image of the page for the slider hover card. While a new page renders, the
// last image stays so the card does not flicker.
export function usePdfPagePreview(
  document: PDFDocumentProxy | null,
  cache: PreviewCache,
  pageNumber: number,
): HTMLCanvasElement | null {
  const [rendered, setRendered] = useState<HTMLCanvasElement | null>(null);
  const cached = cache.get(pageNumber);

  useEffect(() => {
    if (!document || cache.has(pageNumber)) {
      return;
    }
    let active = true;
    let renderTask: RenderTask | undefined;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const canvas = await renderPreview(document, pageNumber, (task) => {
            renderTask = task;
          });
          if (active && canvas) {
            remember(cache, pageNumber, canvas);
            setRendered(canvas);
          }
        } catch (reason) {
          if (!(reason instanceof Error && reason.name === "RenderingCancelledException")) {
            console.warn("Rendering the page preview failed", reason);
          }
        }
      })();
    }, renderDelayMilliseconds);
    return () => {
      active = false;
      window.clearTimeout(timer);
      renderTask?.cancel();
    };
  }, [cache, document, pageNumber]);

  return cached ?? rendered;
}
