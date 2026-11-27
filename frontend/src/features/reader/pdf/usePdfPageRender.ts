import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { normalizePageText } from "../../../shared/lib/text";
import { createPdfTextLayer, type PdfTextLayer } from "../../../shared/pdf/loadPdf";
import { maxScale, minScale, type ZoomMode } from "./usePdfStage";

export type ViewMode = "single" | "spread";

/** The text of the pages on screen, to read aloud. */
export type ReadableText = { pageNumber: number; text: string };

const noText: ReadableText = { pageNumber: 0, text: "" };

type PdfPageRenderOptions = {
  document: PDFDocumentProxy | null;
  pageNumber: number;
  viewMode: ViewMode;
  zoomMode: ZoomMode;
  stageSize: { width: number; height: number };
  canvases: [RefObject<HTMLCanvasElement | null>, RefObject<HTMLCanvasElement | null>];
  textLayers: [RefObject<HTMLDivElement | null>, RefObject<HTMLDivElement | null>];
  /** Runs once the pages are on screen, with the scale they were drawn at. */
  onDrawn: (scale: number) => void;
  /** Runs once the text of the pages is known. */
  onTextReady: (pageCount: number) => void;
  onError: (message: string) => void;
};

/**
 * Draws the page, or two pages for a spread, and lays their text over them
 * so it can be selected. Pages are drawn off screen first, so a new page
 * replaces the old one at once.
 */
export function usePdfPageRender({
  document,
  pageNumber,
  viewMode,
  zoomMode,
  stageSize,
  canvases: [canvasLeftRef, canvasRightRef],
  textLayers: [textLayerLeftRef, textLayerRightRef],
  onDrawn,
  onTextReady,
  onError,
}: PdfPageRenderOptions) {
  const { t } = useTranslation();
  // The pages whose canvases are on screen; highlights follow them, not the requested page.
  const [renderedPages, setRenderedPages] = useState<number[]>([]);
  const [readableText, setReadableText] = useState<ReadableText>(noText);
  const callbacksRef = useRef({ onDrawn, onTextReady, onError });
  useEffect(() => {
    callbacksRef.current = { onDrawn, onTextReady, onError };
  });

  useEffect(() => {
    if (!document) {
      return;
    }
    if (zoomMode.kind === "fit-page" && (stageSize.width === 0 || stageSize.height === 0)) {
      return;
    }
    const leftCanvas = canvasLeftRef.current;
    if (!leftCanvas) {
      return;
    }
    const rightCanvas = canvasRightRef.current;
    const numPages = document.numPages;
    const pageNumbers: number[] = [pageNumber];
    if (viewMode === "spread" && pageNumber + 1 <= numPages) {
      pageNumbers.push(pageNumber + 1);
    }
    if (viewMode === "spread" && !rightCanvas && pageNumbers.length === 2) {
      return;
    }
    const canvases: HTMLCanvasElement[] = [leftCanvas];
    if (pageNumbers.length === 2 && rightCanvas) {
      canvases.push(rightCanvas);
    }

    const textLayerContainers = [textLayerLeftRef.current];
    if (pageNumbers.length === 2) {
      textLayerContainers.push(textLayerRightRef.current);
    }

    let active = true;
    const renderTasks: RenderTask[] = [];
    const textLayers: PdfTextLayer[] = [];

    const pdfDocument = document;

    async function renderPages() {
      const pages = await Promise.all(pageNumbers.map((n) => pdfDocument.getPage(n)));
      if (!active) {
        return;
      }
      const naturalViewports = pages.map((page) => page.getViewport({ scale: 1 }));
      const totalWidth = naturalViewports.reduce((sum, v) => sum + v.width, 0);
      const maxHeight = Math.max(...naturalViewports.map((v) => v.height));
      const fitRatios = [stageSize.width / totalWidth, stageSize.height / maxHeight].filter(
        (ratio) => Number.isFinite(ratio) && ratio > 0,
      );
      const fitScale = fitRatios.length > 0 ? Math.min(...fitRatios) : 1;
      const rawScale = zoomMode.kind === "fit-page" ? fitScale : zoomMode.value;
      const scale =
        zoomMode.kind === "fit-page"
          ? Math.min(maxScale, rawScale || 1)
          : Math.min(maxScale, Math.max(minScale, rawScale || 1));

      const outputScale = window.devicePixelRatio || 1;
      const renderTargets = pages.map((page) => {
        const viewport = page.getViewport({ scale });
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        return { page, viewport, canvas };
      });
      const visibleTargets = canvases.map((canvas, index) => {
        const context = canvas.getContext("2d");
        const source = renderTargets[index];
        if (!context || !source) {
          throw new Error(t("error.canvas"));
        }
        return { canvas, context, source };
      });
      const tasks = renderTargets.map(({ page, viewport, canvas }) => {
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error(t("error.canvas"));
        }
        const task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        renderTasks.push(task);
        return task;
      });
      await Promise.all(tasks.map((task) => task.promise));
      if (!active) {
        return;
      }

      for (const { canvas, context, source } of visibleTargets) {
        canvas.width = source.canvas.width;
        canvas.height = source.canvas.height;
        canvas.style.width = `${Math.floor(source.viewport.width)}px`;
        canvas.style.height = `${Math.floor(source.viewport.height)}px`;
        context.drawImage(source.canvas, 0, 0);
      }
      callbacksRef.current.onDrawn(scale);
      setRenderedPages(pageNumbers);

      const textContents = await Promise.all(pages.map((page) => page.getTextContent()));
      if (!active) {
        return;
      }

      const text = textContents
        .map((textContent) =>
          normalizePageText(
            textContent.items
              .filter((item) => "str" in item)
              .map((item) => ({ str: item.str, hasEOL: item.hasEOL })),
          ),
        )
        .join("\n\n");
      setReadableText({ pageNumber, text });
      callbacksRef.current.onTextReady(pdfDocument.numPages);

      for (const [index, textContent] of textContents.entries()) {
        const container = textLayerContainers[index];
        const target = renderTargets[index];
        const layerPageNumber = pageNumbers[index];
        if (!container || !target || layerPageNumber === undefined) {
          continue;
        }
        container.replaceChildren();
        container.dataset.page = String(layerPageNumber);
        container.style.setProperty("--total-scale-factor", String(target.viewport.scale));
        container.style.setProperty("--scale-round-x", "1px");
        container.style.setProperty("--scale-round-y", "1px");
        // oxlint-disable-next-line eslint/no-await-in-loop -- text layer は page 順に 1 枚ずつ構築する。
        const textLayer = await createPdfTextLayer({
          textContentSource: textContent,
          container,
          viewport: target.viewport,
        });
        if (!active) {
          textLayer.cancel();
          return;
        }
        textLayers.push(textLayer);
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop -- text layer は page 順に 1 枚ずつ構築する。
          await textLayer.render();
        } catch (reason) {
          if (!active) {
            return;
          }
          if (reason instanceof Error && reason.name === "AbortException") {
            return;
          }
          throw reason;
        }
        if (!active) {
          return;
        }
      }
    }

    renderPages().catch((reason: unknown) => {
      if (active && !(reason instanceof Error && reason.name === "RenderingCancelledException")) {
        callbacksRef.current.onError(
          reason instanceof Error ? reason.message : t("error.renderPage"),
        );
      }
    });

    return () => {
      active = false;
      renderTasks.forEach((task) => task.cancel());
      textLayers.forEach((layer) => layer.cancel());
    };
    // The refs hold the same elements for the life of the reader.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [document, pageNumber, stageSize, t, viewMode, zoomMode]);

  const reset = useCallback(() => {
    setRenderedPages([]);
    setReadableText(noText);
  }, []);

  return { renderedPages, readableText, reset };
}
