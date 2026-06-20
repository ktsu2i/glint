import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  BookOpenText,
  CaretLeft,
  CaretRight,
  CornersIn,
  File,
  Minus,
  Plus,
} from "@phosphor-icons/react";
import {
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type RenderTask,
} from "pdfjs-dist";
import type { BookFile } from "../../shared/api/backend";
import { ToolButton } from "../../shared/components/ToolButton";
import { normalizePageText } from "../../shared/lib/text";
import { createPdfLoadingTask } from "./loadPdf";

const loadTimeoutMilliseconds = 60_000;
const minScale = 0.4;
const maxScale = 3;
const manualZoomStep = 0.1;

type ZoomMode = { kind: "fit-page" } | { kind: "manual"; value: number };
type ViewMode = "single" | "spread";

type PdfReaderProps = {
  book: BookFile | null;
  initialPage?: number;
  onPageContextChange: (pageNumber: number, text: string, pageCount: number) => void;
};

export function PdfReader({ book, initialPage = 1, onPageContextChange }: PdfReaderProps) {
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const stageObserverRef = useRef<ResizeObserver | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: "fit-page" });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [effectiveScale, setEffectiveScale] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const stageNodeRef = useRef<HTMLDivElement | null>(null);
  const wheelCleanupRef = useRef<(() => void) | null>(null);
  const effectiveScaleRef = useRef(1);

  useEffect(() => {
    effectiveScaleRef.current = effectiveScale;
  }, [effectiveScale]);

  const stageRef = useCallback((node: HTMLDivElement | null) => {
    stageObserverRef.current?.disconnect();
    stageObserverRef.current = null;
    wheelCleanupRef.current?.();
    wheelCleanupRef.current = null;
    stageNodeRef.current = node;
    if (!node) {
      setStageSize({ width: 0, height: 0 });
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setStageSize((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
      }
    });
    observer.observe(node);
    stageObserverRef.current = observer;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      setZoomMode((current) => {
        const base = current.kind === "manual" ? current.value : effectiveScaleRef.current;
        const factor = Math.exp(-event.deltaY * 0.01);
        const next = Math.min(maxScale, Math.max(minScale, base * factor));
        return { kind: "manual", value: next };
      });
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    wheelCleanupRef.current = () => {
      node.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => () => {
    stageObserverRef.current?.disconnect();
    wheelCleanupRef.current?.();
  }, []);

  useEffect(() => {
    if (!book) {
      setDocument(null);
      setPageNumber(1);
      setError("");
      onPageContextChange(0, "", 0);
      return;
    }

    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let timedOut = false;
    const abortController = new AbortController();
    const bookUrl = book.url;
    setLoading(true);
    setError("");
    setDocument(null);
    setPageNumber(Math.max(1, initialPage));
    setZoomMode({ kind: "fit-page" });
    setEffectiveScale(1);
    onPageContextChange(0, "", 0);

    let timeout = 0;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = window.setTimeout(() => {
        timedOut = true;
        abortController.abort();
        void loadingTask?.destroy();
        reject(new Error("PDF load timed out"));
      }, loadTimeoutMilliseconds);
    });

    async function loadDocument() {
      try {
        const loadedDocument = await Promise.race([
          (async () => {
            loadingTask = await createPdfLoadingTask(bookUrl, abortController.signal);
            return loadingTask.promise;
          })(),
          timeoutPromise,
        ]);
        if (active) {
          setDocument(loadedDocument);
          setPageNumber(Math.min(loadedDocument.numPages, Math.max(1, initialPage)));
        }
      } catch (reason: unknown) {
        if (active) {
          setError(
            timedOut
              ? "PDFの読み込みがタイムアウトしました。アプリを再起動して、もう一度開いてください。"
              : reason instanceof Error
                ? reason.message
                : "PDFを開けませんでした。",
          );
        }
      } finally {
        window.clearTimeout(timeout);
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadDocument();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      abortController.abort();
      void loadingTask?.destroy();
    };
  }, [book, initialPage, onPageContextChange]);

  useEffect(() => {
    if (!document) {
      return;
    }
    const numPages = document.numPages;
    const step = viewMode === "spread" ? 2 : 1;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) {
        return;
      }
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        setPageNumber((current) => Math.min(numPages, current + step));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setPageNumber((current) => Math.max(1, current - step));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [document, viewMode]);

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

    let active = true;
    const renderTasks: RenderTask[] = [];

    async function renderPages() {
      const pages = await Promise.all(pageNumbers.map((n) => document!.getPage(n)));
      if (!active) {
        return;
      }
      const naturalViewports = pages.map((page) => page.getViewport({ scale: 1 }));
      const totalWidth = naturalViewports.reduce((sum, v) => sum + v.width, 0);
      const maxHeight = Math.max(...naturalViewports.map((v) => v.height));
      const fitRatios = [
        stageSize.width / totalWidth,
        stageSize.height / maxHeight,
      ].filter((ratio) => Number.isFinite(ratio) && ratio > 0);
      const fitScale = fitRatios.length > 0 ? Math.min(...fitRatios) : 1;
      const rawScale = zoomMode.kind === "fit-page" ? fitScale : zoomMode.value;
      const scale = zoomMode.kind === "fit-page"
        ? Math.min(maxScale, rawScale || 1)
        : Math.min(maxScale, Math.max(minScale, rawScale || 1));

      const outputScale = window.devicePixelRatio || 1;
      for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i];
        const canvas = canvases[i];
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvasを初期化できませんでした。");
        }
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        renderTasks.push(task);
        await task.promise;
        if (!active) {
          return;
        }
      }
      if (active) {
        setEffectiveScale(scale);
      }

      const textContents = await Promise.all(pages.map((page) => page.getTextContent()));
      if (active) {
        const text = textContents
          .map((textContent) =>
            normalizePageText(
              textContent.items
                .filter((item) => "str" in item)
                .map((item) => ({ str: item.str, hasEOL: item.hasEOL })),
            ),
          )
          .join("\n\n");
        onPageContextChange(pageNumber, text, document!.numPages);
      }
    }

    renderPages().catch((reason: unknown) => {
      if (active && !(reason instanceof Error && reason.name === "RenderingCancelledException")) {
        setError(reason instanceof Error ? reason.message : "ページを描画できませんでした。");
      }
    });

    return () => {
      active = false;
      renderTasks.forEach((task) => task.cancel());
    };
  }, [document, onPageContextChange, pageNumber, stageSize, viewMode, zoomMode]);

  function adjustZoom(delta: number) {
    setZoomMode((current) => {
      const base = current.kind === "manual" ? current.value : effectiveScale;
      const next = Math.min(maxScale, Math.max(minScale, base + delta));
      return { kind: "manual", value: next };
    });
  }

  if (!book) {
    return (
      <section className="reader-empty" aria-label="PDF reader">
        <div className="empty-reading-symbol" aria-hidden="true">
          <BookOpenText size={34} weight="thin" />
          <span />
        </div>
        <p className="section-label">Reading desk</p>
        <h2>本とコードのあいだを読む。</h2>
        <p>検索可能な技術書PDFを開いてください。ページ本文は、必要なときだけ質問に添付できます。</p>
      </section>
    );
  }

  const numPages = document?.numPages ?? 0;
  const step = viewMode === "spread" ? 2 : 1;
  const showRightCanvas = viewMode === "spread" && pageNumber + 1 <= numPages;
  const rightPageNumber = pageNumber + 1;
  const pageRangeLabel = showRightCanvas
    ? `${pageNumber}–${rightPageNumber}`
    : `${pageNumber}`;

  return (
    <section className="reader" aria-label="PDF reader">
      <div className="reader-toolbar">
        <div className="reader-section-label">
          <BookOpenText size={15} weight="regular" />
          <span>Reader</span>
        </div>
        <div className="reader-controls" aria-label="Page controls">
          <ToolButton
            label="前のページ"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((current) => Math.max(1, current - step))}
          >
            <CaretLeft size={15} weight="bold" />
          </ToolButton>
          <span className="page-count">
            {pageRangeLabel} <span>/ {document?.numPages ?? "–"}</span>
          </span>
          <ToolButton
            label="次のページ"
            disabled={!document || pageNumber + step > document.numPages}
            onClick={() => setPageNumber((current) => Math.min(document!.numPages, current + step))}
          >
            <CaretRight size={15} weight="bold" />
          </ToolButton>
        </div>
        <div className="zoom-controls" aria-label="Zoom controls">
          <ToolButton
            label={viewMode === "spread" ? "1ページ表示に切り替え" : "見開き表示に切り替え"}
            className={viewMode === "spread" ? "is-active" : ""}
            onClick={() => setViewMode((current) => (current === "spread" ? "single" : "spread"))}
          >
            {viewMode === "spread" ? (
              <File size={14} weight="bold" />
            ) : (
              <BookOpen size={14} weight="bold" />
            )}
          </ToolButton>
          <ToolButton
            label="全体を表示"
            className={zoomMode.kind === "fit-page" ? "is-active" : ""}
            onClick={() => setZoomMode({ kind: "fit-page" })}
          >
            <CornersIn size={14} weight="bold" />
          </ToolButton>
          <ToolButton label="縮小" onClick={() => adjustZoom(-manualZoomStep)}>
            <Minus size={14} weight="bold" />
          </ToolButton>
          <span>{Math.round(effectiveScale * 100)}%</span>
          <ToolButton label="拡大" onClick={() => adjustZoom(manualZoomStep)}>
            <Plus size={14} weight="bold" />
          </ToolButton>
        </div>
      </div>

      <div className="pdf-stage" ref={stageRef}>
        {loading && <div className="reader-status">PDFを読み込んでいます…</div>}
        {error && <div className="reader-error" role="alert">{error}</div>}
        <div className={`pdf-spread ${viewMode === "spread" ? "is-spread" : "is-single"}`}>
          <canvas
            ref={canvasLeftRef}
            className="pdf-canvas"
            aria-label={`${pageNumber}ページ`}
          />
          {showRightCanvas && (
            <canvas
              ref={canvasRightRef}
              className="pdf-canvas"
              aria-label={`${rightPageNumber}ページ`}
            />
          )}
        </div>
      </div>
    </section>
  );
}
