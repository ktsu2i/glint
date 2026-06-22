import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  BookOpen,
  BookOpenText,
  CaretLeft,
  CaretRight,
  CornersIn,
  File,
  ListBullets,
  MagnifyingGlass,
  Minus,
  Plus,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type RenderTask,
} from "pdfjs-dist";
import {
  saveBookPages,
  searchBook,
  type BookFile,
  type BookPageInput,
  type BookSearchResult,
} from "../../shared/api/backend";
import { ToolButton } from "../../shared/components/ToolButton";
import { normalizePageText } from "../../shared/lib/text";
import { LocalizedError } from "../../shared/i18n/error";
import {
  createPdfLoadingTask,
  createPdfTextLayer,
  extractPdfPage,
  loadPdfOutline,
  type OutlineNode,
  type PdfTextLayer,
} from "./loadPdf";

const loadTimeoutMilliseconds = 60_000;
const minScale = 0.4;
const maxScale = 3;
const manualZoomStep = 0.1;
const pageIndexBatchSize = 16;

type FlatOutlineEntry = { path: string; pageNumber: number | null };

function flattenOutline(nodes: OutlineNode[], parentPath = ""): FlatOutlineEntry[] {
  const result: FlatOutlineEntry[] = [];
  nodes.forEach((node, index) => {
    const path = parentPath ? `${parentPath}.${index}` : String(index);
    result.push({ path, pageNumber: node.pageNumber });
    if (node.children.length > 0) {
      result.push(...flattenOutline(node.children, path));
    }
  });
  return result;
}

type ZoomMode = { kind: "fit-page" } | { kind: "manual"; value: number };
type ViewMode = "single" | "spread";
type ReaderPanel = "toc" | "search" | null;

export type ReaderSelection = {
  text: string;
  pageNumber: number;
};

type PdfReaderProps = {
  book: BookFile | null;
  initialPage?: number;
  onPageContextChange: (pageNumber: number, text: string, pageCount: number) => void;
  onSelectionChange?: (selection: ReaderSelection | null) => void;
  onIndexedPageCountChange?: (count: number) => void;
};

export function PdfReader({
  book,
  initialPage = 1,
  onPageContextChange,
  onSelectionChange,
  onIndexedPageCountChange,
}: PdfReaderProps) {
  const { t } = useTranslation();
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const textLayerLeftRef = useRef<HTMLDivElement>(null);
  const textLayerRightRef = useRef<HTMLDivElement>(null);
  const stageObserverRef = useRef<ResizeObserver | null>(null);
  const selectionCallbackRef = useRef(onSelectionChange);

  useEffect(() => {
    selectionCallbackRef.current = onSelectionChange;
  }, [onSelectionChange]);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [isEditingPage, setIsEditingPage] = useState(false);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: "fit-page" });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [effectiveScale, setEffectiveScale] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [outlineLoaded, setOutlineLoaded] = useState(false);
  const [openPanel, setOpenPanel] = useState<ReaderPanel>(null);
  const [indexedPageCount, setIndexedPageCount] = useState(0);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexError, setIndexError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);

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
      setOutline([]);
      setOutlineLoaded(false);
      setOpenPanel(null);
      setIndexedPageCount(0);
      setIsIndexing(false);
      setIndexError("");
      setSearchQuery("");
      setSubmittedSearchQuery("");
      setSearchResults([]);
      searchRequestRef.current += 1;
      setIsSearching(false);
      setSearchError("");
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
    setOutline([]);
    setOutlineLoaded(false);
    setOpenPanel(null);
    setIndexedPageCount(Math.max(0, book.indexedPageCount ?? 0));
    setIsIndexing(false);
    setIndexError("");
    setSearchQuery("");
    setSubmittedSearchQuery("");
    setSearchResults([]);
    searchRequestRef.current += 1;
    setIsSearching(false);
    setSearchError("");
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
              ? t("error.pdfTimeout")
              : reason instanceof LocalizedError
                ? t(reason.translationKey, reason.values)
                : reason instanceof Error
                ? reason.message
                : t("error.openPdf"),
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
  }, [book?.id, book?.url, initialPage, onPageContextChange, t]);

  useEffect(() => {
    if (!document || !book) {
      return;
    }
    let active = true;
    const pageCount = document.numPages;
    const firstMissingPage = Math.min(pageCount, Math.max(0, book.indexedPageCount ?? 0)) + 1;
    setIndexedPageCount(firstMissingPage - 1);
    setIndexError("");
    if (firstMissingPage > pageCount) {
      setIsIndexing(false);
      return;
    }
    setIsIndexing(true);

    async function indexPages() {
      let batch: BookPageInput[] = [];
      for (let number = firstMissingPage; number <= pageCount; number += 1) {
        const page = await extractPdfPage(document!, number);
        if (!active) {
          return;
        }
        batch.push(page);
        if (batch.length === pageIndexBatchSize || number === pageCount) {
          const persistedCount = await saveBookPages(book!.id, batch, pageCount);
          if (!active) {
            return;
          }
          setIndexedPageCount(persistedCount);
          batch = [];
        }
      }
      if (active) {
        setIsIndexing(false);
        onIndexedPageCountChange?.(pageCount);
      }
    }

    void indexPages().catch((reason: unknown) => {
      if (!active) {
        return;
      }
      setIsIndexing(false);
      setIndexError(reason instanceof Error ? reason.message : t("error.indexBook"));
    });
    return () => {
      active = false;
    };
  }, [book, document, onIndexedPageCountChange, t]);

  useEffect(() => {
    if (openPanel !== "search") {
      return;
    }
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [openPanel]);

  useEffect(() => {
    if (!document) {
      return;
    }
    function openSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setOpenPanel((panel) => panel === "search" ? null : "search");
      }
    }
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [document]);

  useEffect(() => {
    if (!document) {
      return;
    }
    let active = true;
    setOutlineLoaded(false);
    loadPdfOutline(document)
      .then((nodes) => {
        if (active) {
          setOutline(nodes);
          setOutlineLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setOutline([]);
          setOutlineLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [document]);

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
    if (!document || !stageNodeRef.current) {
      return;
    }
    stageNodeRef.current.scrollTop = 0;
    stageNodeRef.current.scrollLeft = 0;
  }, [document, pageNumber]);

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
      const viewports = pages.map((page) => page.getViewport({ scale }));
      for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i];
        const canvas = canvases[i];
        const viewport = viewports[i];
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error(t("error.canvas"));
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
      onPageContextChange(pageNumber, text, document!.numPages);

      for (let i = 0; i < pages.length; i += 1) {
        const container = textLayerContainers[i];
        if (!container) {
          continue;
        }
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        container.dataset.page = String(pageNumbers[i]);
        container.style.setProperty("--total-scale-factor", String(viewports[i].scale));
        container.style.setProperty("--scale-round-x", "1px");
        container.style.setProperty("--scale-round-y", "1px");
        const textLayer = await createPdfTextLayer({
          textContentSource: textContents[i],
          container,
          viewport: viewports[i],
        });
        if (!active) {
          textLayer.cancel();
          return;
        }
        textLayers.push(textLayer);
        try {
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
        setError(reason instanceof Error ? reason.message : t("error.renderPage"));
      }
    });

    return () => {
      active = false;
      renderTasks.forEach((task) => task.cancel());
      textLayers.forEach((layer) => layer.cancel());
    };
  }, [document, onPageContextChange, pageNumber, stageSize, t, viewMode, zoomMode]);

  useEffect(() => {
    function handleSelectionChange() {
      const emit = selectionCallbackRef.current;
      if (!emit) {
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        return;
      }
      const anchorParent = selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode?.parentElement ?? null;
      const focusParent = selection.focusNode instanceof Element
        ? selection.focusNode
        : selection.focusNode?.parentElement ?? null;
      const anchorLayer = anchorParent?.closest<HTMLElement>(".text-layer[data-page]") ?? null;
      const focusLayer = focusParent?.closest<HTMLElement>(".text-layer[data-page]") ?? null;
      if (!anchorLayer || anchorLayer !== focusLayer) {
        return;
      }
      const sourcePage = Number(anchorLayer.dataset.page);
      const text = selection.toString().trim();
      if (!text || !Number.isFinite(sourcePage) || sourcePage < 1) {
        return;
      }
      emit({ text, pageNumber: sourcePage });
    }
    window.document.addEventListener("selectionchange", handleSelectionChange);
    return () => window.document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  useEffect(() => {
    selectionCallbackRef.current?.(null);
  }, [pageNumber]);

  useEffect(() => {
    if (!isEditingPage) {
      setPageInput(String(pageNumber));
    }
  }, [pageNumber, isEditingPage]);

  function commitPageInput() {
    const numPages = document?.numPages ?? 0;
    if (numPages < 1) {
      setPageInput(String(pageNumber));
      return;
    }
    const parsed = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setPageInput(String(pageNumber));
      return;
    }
    const next = Math.min(numPages, parsed);
    setPageNumber(next);
    setPageInput(String(next));
  }

  function startEditingPage() {
    if (!document) {
      return;
    }
    setPageInput(String(pageNumber));
    setIsEditingPage(true);
    window.requestAnimationFrame(() => {
      pageInputRef.current?.focus();
      pageInputRef.current?.select();
    });
  }

  function adjustZoom(delta: number) {
    setZoomMode((current) => {
      const base = current.kind === "manual" ? current.value : effectiveScale;
      const next = Math.min(maxScale, Math.max(minScale, base + delta));
      return { kind: "manual", value: next };
    });
  }

  const flatOutline = useMemo(() => flattenOutline(outline), [outline]);
  const activeOutlineKey = useMemo(() => {
    let last: string | null = null;
    for (const entry of flatOutline) {
      if (entry.pageNumber !== null && entry.pageNumber <= pageNumber) {
        last = entry.path;
      }
    }
    return last;
  }, [flatOutline, pageNumber]);

  const jumpToOutlinePage = useCallback((target: number) => {
    if (!document) {
      return;
    }
    const clamped = Math.min(document.numPages, Math.max(1, target));
    setPageNumber(clamped);
  }, [document]);

  const submitBookSearch = useCallback(async () => {
    if (!book) {
      return;
    }
    const query = searchQuery.trim();
    if (!query) {
      setSubmittedSearchQuery("");
      setSearchResults([]);
      setSearchError("");
      return;
    }
    const request = searchRequestRef.current + 1;
    searchRequestRef.current = request;
    setIsSearching(true);
    setSearchError("");
    setSubmittedSearchQuery(query);
    try {
      const results = await searchBook(book.id, query);
      if (searchRequestRef.current === request) {
        setSearchResults(results);
      }
    } catch (reason) {
      if (searchRequestRef.current === request) {
        setSearchResults([]);
        setSearchError(reason instanceof Error ? reason.message : t("error.searchBook"));
      }
    } finally {
      if (searchRequestRef.current === request) {
        setIsSearching(false);
      }
    }
  }, [book, searchQuery, t]);

  if (!book) {
    return (
      <section className="reader-empty" aria-label={t("reader.aria")}>
        <div className="empty-reading-symbol" aria-hidden="true">
          <BookOpenText size={34} weight="thin" />
          <span />
        </div>
        <p className="section-label">{t("reader.emptyKicker")}</p>
        <h2>{t("reader.emptyTitle")}</h2>
        <p>{t("reader.emptyDescription")}</p>
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
  const pageInputWidth = Math.max(2, String(numPages || 1).length);
  const sliderMaximum = Math.max(1, numPages);
  const sliderValue = Math.min(sliderMaximum, Math.max(1, pageNumber));
  const sliderProgress = numPages > 1
    ? ((sliderValue - 1) / (numPages - 1)) * 100
    : 0;
  const isTocOpen = openPanel === "toc";
  const isSearchOpen = openPanel === "search";

  return (
    <section className="reader" aria-label={t("reader.aria")}>
      <div className="reader-toolbar">
        <div className="reader-section-label">
          <ToolButton
            label={isTocOpen ? t("reader.closeToc") : t("reader.openToc")}
            className={isTocOpen ? "is-active" : ""}
            onClick={() => setOpenPanel((panel) => panel === "toc" ? null : "toc")}
            disabled={!document}
          >
            <ListBullets size={15} weight="regular" />
          </ToolButton>
          <ToolButton
            label={isSearchOpen ? t("reader.closeSearch") : t("reader.openSearch")}
            className={isSearchOpen ? "is-active" : ""}
            onClick={() => setOpenPanel((panel) => panel === "search" ? null : "search")}
            disabled={!document}
          >
            <MagnifyingGlass size={15} weight="bold" />
          </ToolButton>
        </div>
        <div className="reader-controls" aria-label={t("reader.pageControls")}>
          <ToolButton
            label={t("reader.previousPage")}
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((current) => Math.max(1, current - step))}
          >
            <CaretLeft size={15} weight="bold" />
          </ToolButton>
          {isEditingPage ? (
            <form
              className="page-count is-editing"
              onSubmit={(event) => {
                event.preventDefault();
                commitPageInput();
                setIsEditingPage(false);
              }}
            >
              <input
                ref={pageInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label={t("reader.pageNumber")}
                value={pageInput}
                size={pageInputWidth}
                onChange={(event) => setPageInput(event.target.value.replace(/[^0-9]/g, ""))}
                onBlur={() => {
                  commitPageInput();
                  setIsEditingPage(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setPageInput(String(pageNumber));
                    setIsEditingPage(false);
                  }
                }}
              />
              <span>/ {document?.numPages ?? "–"}</span>
            </form>
          ) : (
            <button
              type="button"
              className="page-count"
              aria-label={t("reader.goToPage")}
              onClick={startEditingPage}
              disabled={!document}
            >
              {pageRangeLabel} <span>/ {document?.numPages ?? "–"}</span>
            </button>
          )}
          <ToolButton
            label={t("reader.nextPage")}
            disabled={!document || pageNumber + step > document.numPages}
            onClick={() => setPageNumber((current) => Math.min(document!.numPages, current + step))}
          >
            <CaretRight size={15} weight="bold" />
          </ToolButton>
        </div>
        <div className="zoom-controls" aria-label={t("reader.zoomControls")}>
          <ToolButton
            label={viewMode === "spread" ? t("reader.singlePage") : t("reader.spread")}
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
            label={t("reader.fitPage")}
            className={zoomMode.kind === "fit-page" ? "is-active" : ""}
            onClick={() => setZoomMode({ kind: "fit-page" })}
          >
            <CornersIn size={14} weight="bold" />
          </ToolButton>
          <ToolButton label={t("reader.zoomOut")} onClick={() => adjustZoom(-manualZoomStep)}>
            <Minus size={14} weight="bold" />
          </ToolButton>
          <span>{Math.round(effectiveScale * 100)}%</span>
          <ToolButton label={t("reader.zoomIn")} onClick={() => adjustZoom(manualZoomStep)}>
            <Plus size={14} weight="bold" />
          </ToolButton>
        </div>
      </div>

      <div className={`reader-body ${openPanel ? "toc-open" : "toc-closed"}`}>
        {isTocOpen && (
          <aside className="reader-toc" aria-label={t("reader.toc")}>
            <div className="reader-toc-header">
              <span>{t("reader.toc")}</span>
            </div>
            <div className="reader-toc-scroll">
              {outline.length === 0 ? (
                <p className="reader-toc-empty">
                  {outlineLoaded
                    ? t("reader.noToc")
                    : t("reader.loadingToc")}
                </p>
              ) : (
                <OutlineList
                  nodes={outline}
                  parentPath=""
                  depth={0}
                  activeKey={activeOutlineKey}
                  onSelect={jumpToOutlinePage}
                />
              )}
            </div>
          </aside>
        )}
        {isSearchOpen && (
          <aside className="reader-toc reader-search" aria-label={t("reader.textSearch")}>
            <div className="reader-search-header">
              <form
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitBookSearch();
                }}
              >
                <MagnifyingGlass size={14} aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="search"
                  aria-label={t("reader.openSearch")}
                  placeholder={t("reader.searchPlaceholder")}
                  maxLength={200}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                <button type="submit" disabled={!searchQuery.trim() || isSearching}>
                  {isSearching ? t("reader.searchingAction") : t("reader.searchAction")}
                </button>
              </form>
              <p className={indexError ? "reader-index-status is-error" : "reader-index-status"} aria-live="polite">
                {indexError
                  ? t("reader.indexInterrupted")
                  : isIndexing
                    ? t("reader.indexProgress", { current: indexedPageCount, total: numPages })
                    : indexedPageCount > 0
                      ? t("reader.indexReady", { count: indexedPageCount })
                      : t("reader.indexPreparing")}
              </p>
            </div>
            <div className="reader-search-scroll">
              {searchError ? (
                <p className="reader-search-message is-error" role="alert">{searchError}</p>
              ) : !submittedSearchQuery ? (
                <p className="reader-search-message">{t("reader.searchPrompt")}</p>
              ) : isSearching ? (
                <p className="reader-search-message">{t("reader.searchingFor", { query: submittedSearchQuery })}</p>
              ) : searchResults.length === 0 ? (
                <p className="reader-search-message">
                  {isIndexing
                    ? t("reader.noResultsPartial", { count: indexedPageCount, query: submittedSearchQuery })
                    : t("reader.noResults", { query: submittedSearchQuery })}
                </p>
              ) : (
                <>
                  <p className="reader-search-count">
                    {t("reader.resultsFound", { count: searchResults.length })}
                  </p>
                  <ol className="reader-search-results">
                    {searchResults.map((result) => (
                      <li key={result.pageNumber}>
                        <button
                          type="button"
                          className={result.pageNumber === pageNumber ? "is-active" : ""}
                          aria-label={t("reader.goToResult", { page: result.pageNumber })}
                          onClick={() => jumpToOutlinePage(result.pageNumber)}
                        >
                          <span className="reader-search-result-meta">
                            <strong>PAGE {String(result.pageNumber).padStart(3, "0")}</strong>
                            <span>{t("reader.matches", { count: result.matchCount })}</span>
                          </span>
                          <span className="reader-search-excerpt">
                            <HighlightedExcerpt text={result.excerpt} query={submittedSearchQuery} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          </aside>
        )}
        <div className="pdf-stage" ref={stageRef}>
          {loading && <div className="reader-status">{t("reader.loadingPdf")}</div>}
          {error && <div className="reader-error" role="alert">{error}</div>}
          <div className={`pdf-spread ${viewMode === "spread" ? "is-spread" : "is-single"}`}>
            <div className="pdf-page">
              <canvas
                ref={canvasLeftRef}
                className="pdf-canvas"
                aria-label={t("app.pageLabel", { page: pageNumber })}
              />
              <div
                ref={textLayerLeftRef}
                className="text-layer"
                data-page={pageNumber}
                aria-hidden="true"
              />
            </div>
            {showRightCanvas && (
              <div className="pdf-page">
                <canvas
                  ref={canvasRightRef}
                  className="pdf-canvas"
                  aria-label={t("app.pageLabel", { page: rightPageNumber })}
                />
                <div
                  ref={textLayerRightRef}
                  className="text-layer"
                  data-page={rightPageNumber}
                  aria-hidden="true"
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="reader-page-slider">
        <input
          id="reader-page-slider"
          type="range"
          min={1}
          max={sliderMaximum}
          step={1}
          value={sliderValue}
          aria-label={t("reader.pageSlider")}
          aria-valuetext={t("reader.pageOfTotal", { current: sliderValue, total: numPages || 1 })}
          disabled={!document}
          style={{ "--page-progress": `${sliderProgress}%` } as CSSProperties}
          onChange={(event) => setPageNumber(Number(event.target.value))}
        />
      </div>
    </section>
  );
}

type OutlineListProps = {
  nodes: OutlineNode[];
  parentPath: string;
  depth: number;
  activeKey: string | null;
  onSelect: (pageNumber: number) => void;
};

function OutlineList({ nodes, parentPath, depth, activeKey, onSelect }: OutlineListProps) {
  const { t } = useTranslation();
  return (
    <ul className="reader-toc-list" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node, index) => {
        const path = parentPath ? `${parentPath}.${index}` : String(index);
        const isActive = path === activeKey;
        const hasPage = node.pageNumber !== null;
        return (
          <li key={path} role="treeitem" aria-expanded={node.children.length > 0 ? true : undefined}>
            <button
              type="button"
              className={`reader-toc-item${isActive ? " is-active" : ""}`}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              disabled={!hasPage}
              onClick={() => hasPage && onSelect(node.pageNumber as number)}
            >
              <span className="reader-toc-title">{node.title || t("reader.untitled")}</span>
              {hasPage && (
                <span className="reader-toc-page">{node.pageNumber}</span>
              )}
            </button>
            {node.children.length > 0 && (
              <OutlineList
                nodes={node.children}
                parentPath={path}
                depth={depth + 1}
                activeKey={activeKey}
                onSelect={onSelect}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HighlightedExcerpt({ text, query }: { text: string; query: string }) {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (terms.length === 0) {
    return text;
  }
  const expression = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "giu",
  );
  const foldedTerms = new Set(terms.map((term) => term.toLocaleLowerCase()));
  return text.split(expression).map((part, index) =>
    foldedTerms.has(part.toLocaleLowerCase())
      ? <mark key={`${index}-${part}`}>{part}</mark>
      : part,
  );
}
