import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenIcon, BookOpenTextIcon, CornersInIcon, FileIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { type PDFDocumentProxy, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import {
  addBookmark,
  addHighlight,
  listBookmarks,
  listHighlights,
  removeBookmark,
  removeHighlight,
  changeHighlightColor,
  saveBindingDirection,
  searchBook,
  type BookBookmark,
  type BookHighlight,
  type HighlightColor,
} from "./api";
import type { BindingDirection, BookFile, BookSearchResult } from "../../shared/api/books";
import { normalizePageText } from "../../shared/lib/text";
import { LocalizedError, translateLocalizedError } from "../../shared/i18n/error";
import { BookmarkList, HighlightList } from "./common/AnnotationLists";
import { BookSearchPanel } from "./common/BookSearchPanel";
import {
  floatingStyle,
  HighlightActionsToolbar,
  SelectionHighlightToolbar,
} from "./common/HighlightToolbars";
import { ReaderBottomBar } from "./common/ReaderBottomBar";
import { ReaderSheet } from "./common/ReaderSheet";
import { ReaderTopBar, useReaderPanel } from "./common/ReaderTopBar";
import { LayoutSection, ReaderViewMenu, ScaleSection } from "./common/ReaderViewMenu";
import { showWindowControls } from "./common/windowControls";
import { rectContainsPoint, selectionToPageSelections, type PageSelection } from "./highlights";
import {
  createPdfLoadingTask,
  createPdfTextLayer,
  loadPdfOutline,
  type OutlineNode,
  type PdfTextLayer,
} from "../../shared/pdf/loadPdf";
import {
  detectUtteranceLang,
  isSpeechSupported,
  pickVoiceForLang,
  useSpeechVoices,
} from "./speech";

const loadTimeoutMilliseconds = 60_000;
const minScale = 0.4;
const maxScale = 3;
const manualZoomStep = 0.1;

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
// Floating controls are placed in the reader's coordinates.
type PendingSelection = { parts: PageSelection[]; x: number; top: number; bottom: number };
type ActiveHighlight = { id: number; x: number; top: number; bottom: number };

function sortHighlights(highlights: BookHighlight[]): BookHighlight[] {
  return highlights.toSorted((a, b) => a.pageNumber - b.pageNumber || a.id - b.id);
}

function bindingDirectionOf(book: BookFile | null): BindingDirection {
  return book?.bindingDirection === "rtl" ? "rtl" : "ltr";
}

type PdfReaderProps = {
  book: BookFile | null;
  initialPage?: number;
  onPageChange: (pageNumber: number, pageCount: number) => void;
  onBack?: () => void;
};

export function PdfReader({ book, initialPage = 1, onPageChange, onBack }: PdfReaderProps) {
  const { t, i18n } = useTranslation();
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const textLayerLeftRef = useRef<HTMLDivElement>(null);
  const textLayerRightRef = useRef<HTMLDivElement>(null);
  const stageObserverRef = useRef<ResizeObserver | null>(null);
  const pageChangeCallbackRef = useRef(onPageChange);

  useEffect(() => {
    pageChangeCallbackRef.current = onPageChange;
  }, [onPageChange]);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [isEditingPage, setIsEditingPage] = useState(false);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [bindingDirection, setBindingDirection] = useState<BindingDirection>(() =>
    bindingDirectionOf(book),
  );
  const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: "fit-page" });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [effectiveScale, setEffectiveScale] = useState(1);
  const [error, setError] = useState("");
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [outlineLoaded, setOutlineLoaded] = useState(false);
  const { openPanel, setOpenPanel, togglePanel } = useReaderPanel();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isTopbarHovered, setIsTopbarHovered] = useState(false);
  const [isTopbarFocused, setIsTopbarFocused] = useState(false);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [bookmarks, setBookmarks] = useState<BookBookmark[]>([]);
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [bookmarkBusyPage, setBookmarkBusyPage] = useState<number | null>(null);
  const [bookmarkError, setBookmarkError] = useState("");
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  const [highlightsLoaded, setHighlightsLoaded] = useState(false);
  const [highlightBusy, setHighlightBusy] = useState(false);
  const [highlightError, setHighlightError] = useState("");
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<ActiveHighlight | null>(null);
  // The pages whose canvases are on screen; highlights follow them, not the requested page.
  const [renderedPages, setRenderedPages] = useState<number[]>([]);
  const readerRef = useRef<HTMLElement>(null);
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const [readableText, setReadableText] = useState<{
    pageNumber: number;
    text: string;
  }>({ pageNumber: 0, text: "" });
  const isReadingAloudRef = useRef(false);
  const speechSupported = isSpeechSupported();
  const voices = useSpeechVoices(speechSupported);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);

  const stageNodeRef = useRef<HTMLDivElement | null>(null);
  const stageClickRef = useRef<(event: MouseEvent) => void>(() => {});
  const stageMouseUpRef = useRef<() => void>(() => {});
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
          current.width === width && current.height === height ? current : { width, height },
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
    // Clicking the page toggles the floating controls; Escape does the same from the keyboard.
    const handleClick = (event: MouseEvent) => stageClickRef.current(event);
    // Releasing a text selection offers the highlight colors.
    const handleMouseUp = () => stageMouseUpRef.current();
    // Floating controls are placed for one scroll position, so scrolling dismisses them.
    const handleScroll = () => {
      setPendingSelection(null);
      setActiveHighlight(null);
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    node.addEventListener("click", handleClick);
    node.addEventListener("mouseup", handleMouseUp);
    node.addEventListener("scroll", handleScroll);
    wheelCleanupRef.current = () => {
      node.removeEventListener("wheel", handleWheel);
      node.removeEventListener("click", handleClick);
      node.removeEventListener("mouseup", handleMouseUp);
      node.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(
    () => () => {
      stageObserverRef.current?.disconnect();
      wheelCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    setIsReadingAloud(false);
    setReadableText({ pageNumber: 0, text: "" });
    if (speechSupported) {
      window.speechSynthesis.cancel();
    }
    if (!book) {
      setDocument(null);
      setRenderedPages([]);
      setPageNumber(1);
      setError("");
      setOutline([]);
      setOutlineLoaded(false);
      setOpenPanel(null);
      setSearchQuery("");
      setSubmittedSearchQuery("");
      setSearchResults([]);
      searchRequestRef.current += 1;
      setIsSearching(false);
      setSearchError("");
      pageChangeCallbackRef.current(0, 0);
      return;
    }

    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let timedOut = false;
    const abortController = new AbortController();
    const bookUrl = book.url;
    setError("");
    setDocument(null);
    setRenderedPages([]);
    setOutline([]);
    setOutlineLoaded(false);
    setOpenPanel(null);
    setIsViewMenuOpen(false);
    setChromeVisible(true);
    setSearchQuery("");
    setSubmittedSearchQuery("");
    setSearchResults([]);
    searchRequestRef.current += 1;
    setIsSearching(false);
    setSearchError("");
    setPageNumber(Math.max(1, initialPage));
    setZoomMode({ kind: "fit-page" });
    setEffectiveScale(1);
    setBindingDirection(bindingDirectionOf(book));
    pageChangeCallbackRef.current(0, 0);

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
                ? translateLocalizedError(reason, t)
                : reason instanceof Error
                  ? reason.message
                  : t("error.openPdf"),
          );
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadDocument();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      abortController.abort();
      void loadingTask?.destroy();
    };
    // oxlint-disable-next-line react/exhaustive-deps -- book の id / url が変わった時だけ再読み込みする。
  }, [book?.id, book?.url, initialPage, t]);

  useEffect(() => {
    let active = true;
    setBookmarks([]);
    setBookmarksLoaded(false);
    setBookmarkBusyPage(null);
    setBookmarkError("");
    if (!book) {
      return () => {
        active = false;
      };
    }
    const bookId = book.id;
    const load = async () => {
      try {
        const saved = await listBookmarks(bookId);
        if (active) {
          setBookmarks(saved);
          setBookmarksLoaded(true);
        }
      } catch (reason: unknown) {
        if (active) {
          setBookmarksLoaded(true);
          setBookmarkError(reason instanceof Error ? reason.message : t("error.loadBookmarks"));
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-deps -- book の id が変わった時だけ bookmark を読み直す。
  }, [book?.id, t]);

  useEffect(() => {
    let active = true;
    setHighlights([]);
    setHighlightsLoaded(false);
    setHighlightBusy(false);
    setHighlightError("");
    if (!book) {
      return () => {
        active = false;
      };
    }
    const bookId = book.id;
    const load = async () => {
      try {
        const saved = await listHighlights(bookId);
        if (active) {
          setHighlights(sortHighlights(saved));
          setHighlightsLoaded(true);
        }
      } catch (reason: unknown) {
        if (active) {
          setHighlightsLoaded(true);
          setHighlightError(reason instanceof Error ? reason.message : t("error.loadHighlights"));
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-deps -- book の id が変わった時だけ highlight を読み直す。
  }, [book?.id, t]);

  useEffect(() => {
    setPendingSelection(null);
    setActiveHighlight(null);
  }, [book?.id, pageNumber, viewMode, zoomMode, stageSize]);

  useEffect(() => {
    // Clicking elsewhere collapses the selection, and the colors go with it.
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setPendingSelection(null);
      }
    };
    globalThis.document.addEventListener("selectionchange", handleSelectionChange);
    return () => globalThis.document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

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
        togglePanel("search");
      }
    }
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [document, togglePanel]);

  useEffect(() => {
    if (!document) {
      return;
    }
    let active = true;
    setOutlineLoaded(false);
    const pdfDocument = document;
    const load = async () => {
      let nodes: OutlineNode[] = [];
      try {
        nodes = await loadPdfOutline(pdfDocument);
      } catch {}
      if (active) {
        setOutline(nodes);
        setOutlineLoaded(true);
      }
    };
    void load();
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
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.isContentEditable === true) {
        return;
      }
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
      const forwardKeys =
        bindingDirection === "rtl" ? ["ArrowLeft", "PageDown"] : ["ArrowRight", "PageDown"];
      const backwardKeys =
        bindingDirection === "rtl" ? ["ArrowRight", "PageUp"] : ["ArrowLeft", "PageUp"];
      if (forwardKeys.includes(event.key)) {
        event.preventDefault();
        setPageNumber((current) => Math.min(numPages, current + step));
        setChromeVisible(false);
      } else if (backwardKeys.includes(event.key)) {
        event.preventDefault();
        setPageNumber((current) => Math.max(1, current - step));
        setChromeVisible(false);
      } else if (event.key === "Escape") {
        if (pendingSelection || activeHighlight) {
          setPendingSelection(null);
          setActiveHighlight(null);
          window.getSelection()?.removeAllRanges();
        } else if (openPanel || isViewMenuOpen) {
          setOpenPanel(null);
          setIsViewMenuOpen(false);
        } else {
          setChromeVisible((current) => !current);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    document,
    viewMode,
    bindingDirection,
    isViewMenuOpen,
    openPanel,
    pendingSelection,
    activeHighlight,
    setOpenPanel,
  ]);

  useEffect(() => {
    stageClickRef.current = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button, a, input, textarea, select")) {
        return;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim() !== "") {
        return;
      }
      if (activeHighlight) {
        setActiveHighlight(null);
        return;
      }
      const hit = highlightAt(event.clientX, event.clientY);
      const reader = readerRef.current?.getBoundingClientRect();
      if (hit && reader) {
        setActiveHighlight({
          id: hit.id,
          x: event.clientX - reader.left,
          top: event.clientY - reader.top,
          bottom: event.clientY - reader.top,
        });
        return;
      }
      if (openPanel || isViewMenuOpen) {
        setOpenPanel(null);
        setIsViewMenuOpen(false);
        return;
      }
      setChromeVisible((current) => !current);
    };

    function highlightAt(clientX: number, clientY: number): BookHighlight | undefined {
      const pages = stageNodeRef.current?.querySelectorAll<HTMLElement>(".pdf-page[data-page]");
      for (const page of pages ?? []) {
        const box = page.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) {
          continue;
        }
        const x = (clientX - box.left) / box.width;
        const y = (clientY - box.top) / box.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) {
          continue;
        }
        const hitPage = Number(page.dataset.page);
        // The latest highlight is drawn on top, so it wins.
        return highlights.findLast(
          (highlight) =>
            highlight.pageNumber === hitPage &&
            highlight.rects.some((rect) => rectContainsPoint(rect, x, y)),
        );
      }
      return undefined;
    }

    stageMouseUpRef.current = () => {
      const selection = window.getSelection();
      const stage = stageNodeRef.current;
      const reader = readerRef.current?.getBoundingClientRect();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !stage || !reader) {
        return;
      }
      const range = selection.getRangeAt(0);
      const pages = Array.from(stage.querySelectorAll<HTMLElement>(".pdf-page[data-page]"));
      const parts = selectionToPageSelections(range, pages);
      if (parts.length === 0) {
        setPendingSelection(null);
        return;
      }
      const bounds = range.getBoundingClientRect();
      setActiveHighlight(null);
      setPendingSelection({
        parts,
        x: bounds.left + bounds.width / 2 - reader.left,
        top: bounds.top - reader.top,
        bottom: bounds.bottom - reader.top,
      });
    };
  }, [activeHighlight, highlights, isViewMenuOpen, openPanel, setOpenPanel]);

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
      setEffectiveScale(scale);
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
      pageChangeCallbackRef.current(pageNumber, pdfDocument.numPages);

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
        setError(reason instanceof Error ? reason.message : t("error.renderPage"));
      }
    });

    return () => {
      active = false;
      renderTasks.forEach((task) => task.cancel());
      textLayers.forEach((layer) => layer.cancel());
    };
  }, [document, pageNumber, stageSize, t, viewMode, zoomMode]);

  useEffect(() => {
    isReadingAloudRef.current = isReadingAloud;
  }, [isReadingAloud]);

  useEffect(() => {
    if (!speechSupported) {
      return;
    }
    return () => {
      window.speechSynthesis.cancel();
    };
  }, [speechSupported]);

  useEffect(() => {
    if (!speechSupported || !isReadingAloud || !document) {
      return;
    }
    if (readableText.pageNumber !== pageNumber || readableText.text.trim() === "") {
      return;
    }
    const detectedLang = detectUtteranceLang(readableText.text, i18n.language);
    const utterance = new SpeechSynthesisUtterance(readableText.text);
    utterance.lang = detectedLang;
    const voice = pickVoiceForLang(voices, detectedLang);
    if (voice) {
      utterance.voice = voice;
    }
    const numPages = document.numPages;
    utterance.addEventListener("end", () => {
      if (!isReadingAloudRef.current) {
        return;
      }
      if (pageNumber >= numPages) {
        setIsReadingAloud(false);
        return;
      }
      setPageNumber((current) => Math.min(numPages, current + 1));
    });
    utterance.addEventListener("error", () => {
      setIsReadingAloud(false);
    });
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return () => {
      window.speechSynthesis.cancel();
    };
  }, [document, i18n.language, isReadingAloud, pageNumber, readableText, speechSupported, voices]);

  const toggleReadAloud = useCallback(() => {
    if (!speechSupported) {
      return;
    }
    setIsReadingAloud((current) => {
      if (current) {
        window.speechSynthesis.cancel();
        return false;
      }
      return true;
    });
  }, [speechSupported]);

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
    const parsed = Math.trunc(Number(pageInput));
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

  function changeBinding(next: BindingDirection) {
    setBindingDirection(next);
    if (book) {
      saveBindingDirection(book.id, next).catch((reason: unknown) => {
        console.warn("Saving the binding direction failed", reason);
      });
    }
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

  const jumpToOutlinePage = useCallback(
    (target: number) => {
      if (!document) {
        return;
      }
      const clamped = Math.min(document.numPages, Math.max(1, target));
      setPageNumber(clamped);
    },
    [document],
  );

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

  const chromeShown = chromeVisible || openPanel !== null || isViewMenuOpen;
  // The top bar also appears on hover and focus, and the traffic lights sit
  // inside it, so they follow the bar rather than chromeShown alone.
  const windowControlsShown = !book || chromeShown || isTopbarHovered || isTopbarFocused;

  useEffect(() => {
    // The native buttons fade over the same duration as the toolbars.
    showWindowControls(windowControlsShown);
  }, [windowControlsShown]);

  useEffect(() => () => showWindowControls(true), []);

  if (!book) {
    return (
      <section className="reader-empty" aria-label={t("reader.aria")}>
        <div className="empty-reading-symbol" aria-hidden="true">
          <BookOpenTextIcon size={34} weight="thin" />
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
  const isRtlBinding = bindingDirection === "rtl";
  const pageRangeLabel = showRightCanvas
    ? isRtlBinding
      ? `${rightPageNumber}–${pageNumber}`
      : `${pageNumber}–${rightPageNumber}`
    : `${pageNumber}`;
  const pageInputWidth = Math.max(2, String(numPages || 1).length);
  const sliderMaximum = Math.max(1, numPages);
  const sliderValue = Math.min(sliderMaximum, Math.max(1, pageNumber));
  const sliderProgress = numPages > 1 ? ((sliderValue - 1) / (numPages - 1)) * 100 : 0;
  const canTurnForward = document !== null && pageNumber + step <= document.numPages;
  const turnForward = () =>
    setPageNumber((current) => Math.min(document?.numPages ?? current, current + step));
  const turnBack = () => setPageNumber((current) => Math.max(1, current - step));
  const pageBookmarks =
    numPages > 0 ? bookmarks.filter((bookmark) => bookmark.pageNumber <= numPages) : bookmarks;
  const currentPageBookmarked = bookmarks.some((bookmark) => bookmark.pageNumber === pageNumber);

  async function deleteBookmark(page: number) {
    if (!book) {
      return;
    }
    setBookmarkBusyPage(page);
    setBookmarkError("");
    try {
      await removeBookmark(book.id, page);
      setBookmarks((current) => current.filter((entry) => entry.pageNumber !== page));
    } catch (reason) {
      setBookmarkError(reason instanceof Error ? reason.message : t("error.saveBookmark"));
    } finally {
      setBookmarkBusyPage(null);
    }
  }

  async function toggleCurrentPageBookmark() {
    if (!book || !document || bookmarkBusyPage !== null) {
      return;
    }
    setBookmarkBusyPage(pageNumber);
    setBookmarkError("");
    try {
      if (currentPageBookmarked) {
        await removeBookmark(book.id, pageNumber);
        setBookmarks((current) => current.filter((bookmark) => bookmark.pageNumber !== pageNumber));
      } else {
        const saved = await addBookmark(book.id, pageNumber, document.numPages);
        setBookmarks((current) =>
          [...current, saved].toSorted((a, b) => a.pageNumber - b.pageNumber),
        );
      }
    } catch (reason) {
      setBookmarkError(reason instanceof Error ? reason.message : t("error.saveBookmark"));
    } finally {
      setBookmarkBusyPage(null);
    }
  }

  const pageHighlights =
    numPages > 0 ? highlights.filter((highlight) => highlight.pageNumber <= numPages) : highlights;
  const highlightedText = activeHighlight
    ? highlights.find((highlight) => highlight.id === activeHighlight.id)
    : undefined;

  async function saveSelectionHighlight(color: HighlightColor) {
    if (!book || !document || !pendingSelection || highlightBusy) {
      return;
    }
    const bookId = book.id;
    const pageCount = document.numPages;
    setHighlightBusy(true);
    setHighlightError("");
    // A selection across a spread becomes one highlight per page.
    const results = await Promise.allSettled(
      pendingSelection.parts.map((part) => addHighlight(bookId, { ...part, color, pageCount })),
    );
    const saved = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failure = results.find((result) => result.status === "rejected");
    setHighlights((current) => sortHighlights([...current, ...saved]));
    if (failure) {
      const reason: unknown = failure.reason;
      setHighlightError(reason instanceof Error ? reason.message : t("error.saveHighlight"));
    } else {
      window.getSelection()?.removeAllRanges();
      setPendingSelection(null);
    }
    setHighlightBusy(false);
  }

  async function recolorHighlight(id: number, color: HighlightColor) {
    if (!book || highlightBusy) {
      return;
    }
    setHighlightBusy(true);
    setHighlightError("");
    try {
      const updated = await changeHighlightColor(book.id, id, color);
      setHighlights((current) =>
        current.map((highlight) => (highlight.id === id ? updated : highlight)),
      );
    } catch (reason) {
      setHighlightError(reason instanceof Error ? reason.message : t("error.saveHighlight"));
    } finally {
      setHighlightBusy(false);
    }
  }

  async function deleteHighlight(id: number) {
    if (!book || highlightBusy) {
      return;
    }
    setHighlightBusy(true);
    setHighlightError("");
    try {
      await removeHighlight(book.id, id);
      setHighlights((current) => current.filter((highlight) => highlight.id !== id));
      setActiveHighlight((current) => (current?.id === id ? null : current));
    } catch (reason) {
      setHighlightError(reason instanceof Error ? reason.message : t("error.saveHighlight"));
    } finally {
      setHighlightBusy(false);
    }
  }

  function renderHighlightLayer(layerPageNumber: number | undefined) {
    if (layerPageNumber === undefined) {
      return null;
    }
    return (
      <div className="highlight-layer" aria-hidden="true">
        {highlights
          .filter((highlight) => highlight.pageNumber === layerPageNumber)
          .flatMap((highlight) =>
            highlight.rects.map((rect) => (
              <div
                key={`${highlight.id}-${rect.x}-${rect.y}`}
                className={`highlight-mark is-${highlight.color}${
                  highlight.id === activeHighlight?.id ? " is-active" : ""
                }`}
                data-highlight-id={highlight.id}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
              />
            )),
          )}
      </div>
    );
  }

  // Floating controls stay inside the reader.
  const readerWidth = readerRef.current?.clientWidth ?? 0;

  return (
    <section
      ref={readerRef}
      className={`reader ambient${chromeShown ? " is-chrome-visible" : ""}`}
      aria-label={t("reader.aria")}
    >
      <div className="reader-drag-region" aria-hidden="true" />

      <div className="pdf-stage" ref={stageRef}>
        {error && (
          <div className="reader-error" role="alert">
            {error}
          </div>
        )}
        <div
          className={`pdf-spread ${viewMode === "spread" ? "is-spread" : "is-single"}${isRtlBinding ? " is-rtl" : ""}`}
        >
          <div className="pdf-page" data-page={renderedPages[0]}>
            <canvas
              ref={canvasLeftRef}
              className="pdf-canvas"
              aria-label={t("app.pageLabel", { page: pageNumber })}
            />
            {renderHighlightLayer(renderedPages[0])}
            <div
              ref={textLayerLeftRef}
              className="text-layer"
              data-page={pageNumber}
              aria-hidden="true"
            />
          </div>
          {showRightCanvas && (
            <div className="pdf-page" data-page={renderedPages[1]}>
              <canvas
                ref={canvasRightRef}
                className="pdf-canvas"
                aria-label={t("app.pageLabel", { page: rightPageNumber })}
              />
              {renderHighlightLayer(renderedPages[1])}
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

      {document && (
        <p className="reader-status" aria-hidden="true">
          {pageRangeLabel} / {numPages}
        </p>
      )}

      <ReaderTopBar
        ready={document !== null}
        title={book.title}
        subtitle={
          document ? (
            <>
              {pageRangeLabel} / {numPages}
            </>
          ) : null
        }
        openPanel={openPanel}
        onTogglePanel={togglePanel}
        readAloud={{
          supported: speechSupported,
          active: isReadingAloud,
          onToggle: toggleReadAloud,
        }}
        bookmark={{
          label: currentPageBookmarked
            ? t("reader.removePageBookmark", { page: pageNumber })
            : t("reader.savePageBookmark", { page: pageNumber }),
          active: currentPageBookmarked,
          disabled: bookmarkBusyPage !== null,
          onToggle: () => void toggleCurrentPageBookmark(),
        }}
        viewMenu={{
          open: isViewMenuOpen,
          icon:
            viewMode === "spread" ? (
              <BookOpenIcon size={17} weight="regular" />
            ) : (
              <FileIcon size={17} weight="regular" />
            ),
          onToggle: () => setIsViewMenuOpen((current) => !current),
        }}
        onHoverChange={setIsTopbarHovered}
        onFocusChange={setIsTopbarFocused}
        onBack={onBack}
      />

      {isViewMenuOpen && (
        <ReaderViewMenu>
          <LayoutSection layout={viewMode} onChange={setViewMode} />
          <section>
            <h2>{t("reader.bindingHeading")}</h2>
            <div className="segmented" role="group" aria-label={t("reader.bindingHeading")}>
              <button
                type="button"
                aria-pressed={!isRtlBinding}
                onClick={() => changeBinding("ltr")}
              >
                {t("reader.bindingLtr")}
              </button>
              <button
                type="button"
                aria-pressed={isRtlBinding}
                onClick={() => changeBinding("rtl")}
              >
                {t("reader.bindingRtl")}
              </button>
            </div>
            <p>{isRtlBinding ? t("reader.bindingRtlNote") : t("reader.bindingLtrNote")}</p>
          </section>
          <ScaleSection
            heading={t("reader.zoomHeading")}
            value={`${Math.round(effectiveScale * 100)}%`}
            decrease={{ label: t("reader.zoomOut"), onClick: () => adjustZoom(-manualZoomStep) }}
            increase={{ label: t("reader.zoomIn"), onClick: () => adjustZoom(manualZoomStep) }}
            reset={{
              label: t("reader.fitPage"),
              icon: <CornersInIcon size={14} aria-hidden="true" />,
              pressed: zoomMode.kind === "fit-page",
              onClick: () => setZoomMode({ kind: "fit-page" }),
            }}
          />
        </ReaderViewMenu>
      )}

      {(bookmarkError || highlightError) && (
        <div className="reader-bookmark-error" role="alert">
          {bookmarkError || highlightError}
        </div>
      )}

      {pendingSelection && (
        <SelectionHighlightToolbar
          style={floatingStyle(pendingSelection, readerWidth)}
          busy={highlightBusy}
          onPick={(color) => void saveSelectionHighlight(color)}
        />
      )}

      {activeHighlight && highlightedText && (
        <HighlightActionsToolbar
          style={floatingStyle(activeHighlight, readerWidth)}
          color={highlightedText.color}
          busy={highlightBusy}
          onRecolor={(color) => void recolorHighlight(highlightedText.id, color)}
          onRemove={() => void deleteHighlight(highlightedText.id)}
        />
      )}

      {openPanel && (
        <ReaderSheet
          panel={openPanel}
          count={
            openPanel === "bookmarks"
              ? pageBookmarks.length
              : openPanel === "highlights"
                ? pageHighlights.length
                : 0
          }
          onClose={() => setOpenPanel(null)}
        >
          {openPanel === "toc" && (
            <div className="reader-sheet-scroll">
              {outline.length === 0 ? (
                <p className="reader-sheet-message">
                  {outlineLoaded ? t("reader.noToc") : t("reader.loadingToc")}
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
          )}
          {openPanel === "search" && (
            <BookSearchPanel
              inputRef={searchInputRef}
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onSubmit={() => void submitBookSearch()}
              submittedQuery={submittedSearchQuery}
              searching={isSearching}
              error={searchError}
              results={searchResults}
              describeResult={(result) => ({
                title: t("reader.bookmarkPage", { page: result.pageNumber }),
                label: t("reader.goToResult", { page: result.pageNumber }),
                active: result.pageNumber === pageNumber,
              })}
              onSelectResult={(result) => jumpToOutlinePage(result.pageNumber)}
            />
          )}
          {openPanel === "highlights" && (
            <HighlightList
              loaded={highlightsLoaded}
              error={highlightError}
              busy={highlightBusy}
              entries={pageHighlights.map((highlight) => ({
                key: highlight.id,
                color: highlight.color,
                active: renderedPages.includes(highlight.pageNumber),
                place: t("reader.bookmarkPage", { page: highlight.pageNumber }),
                text: highlight.text,
                goLabel: t("reader.goToHighlight", { page: highlight.pageNumber }),
                removeLabel: t("reader.removeHighlightOnPage", { page: highlight.pageNumber }),
                onGo: () => jumpToOutlinePage(highlight.pageNumber),
                onRemove: () => void deleteHighlight(highlight.id),
              }))}
            />
          )}
          {openPanel === "bookmarks" && (
            <BookmarkList
              loaded={bookmarksLoaded}
              error={bookmarkError}
              busy={bookmarkBusyPage !== null}
              emptyMessage={t("reader.noBookmarks")}
              entries={pageBookmarks.map((bookmark) => ({
                key: bookmark.pageNumber,
                active: bookmark.pageNumber === pageNumber,
                title: t("reader.bookmarkPage", { page: bookmark.pageNumber }),
                detail: t("reader.bookmarkSaved"),
                goLabel: t("reader.goToBookmark", { page: bookmark.pageNumber }),
                removeLabel: t("reader.removePageBookmark", { page: bookmark.pageNumber }),
                onGo: () => jumpToOutlinePage(bookmark.pageNumber),
                onRemove: () => void deleteBookmark(bookmark.pageNumber),
              }))}
            />
          )}
        </ReaderSheet>
      )}

      <ReaderBottomBar
        left={{
          label: isRtlBinding ? t("reader.nextPage") : t("reader.previousPage"),
          disabled: isRtlBinding ? !canTurnForward : pageNumber <= 1,
          onClick: isRtlBinding ? turnForward : turnBack,
        }}
        right={{
          label: isRtlBinding ? t("reader.previousPage") : t("reader.nextPage"),
          disabled: isRtlBinding ? pageNumber <= 1 : !canTurnForward,
          onClick: isRtlBinding ? turnBack : turnForward,
        }}
        counter={
          isEditingPage ? (
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
                onChange={(event) => setPageInput(event.target.value.replaceAll(/[^0-9]/g, ""))}
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
          )
        }
        rtl={isRtlBinding}
        slider={
          <input
            id="reader-page-slider"
            type="range"
            min={1}
            max={sliderMaximum}
            step={1}
            value={sliderValue}
            aria-label={t("reader.pageSlider")}
            aria-valuetext={t("reader.pageOfTotal", {
              current: sliderValue,
              total: numPages || 1,
            })}
            disabled={!document}
            dir={isRtlBinding ? "rtl" : "ltr"}
            style={{ "--page-progress": `${sliderProgress}%` }}
            onChange={(event) => setPageNumber(Number(event.target.value))}
          />
        }
        markers={
          document
            ? pageBookmarks.map((bookmark) => ({
                key: bookmark.pageNumber,
                position: numPages > 1 ? ((bookmark.pageNumber - 1) / (numPages - 1)) * 100 : 0,
                current: bookmark.pageNumber === pageNumber,
                label: t("reader.sliderBookmark", { page: bookmark.pageNumber }),
                tooltip: t("reader.bookmarkPage", { page: bookmark.pageNumber }),
                onGo: () => jumpToOutlinePage(bookmark.pageNumber),
              }))
            : []
        }
      />
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
          <li
            key={path}
            role="treeitem"
            aria-expanded={node.children.length > 0 ? true : undefined}
          >
            <button
              type="button"
              className={`reader-toc-item${isActive ? " is-active" : ""}`}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              disabled={!hasPage}
              onClick={() => {
                if (node.pageNumber !== null) onSelect(node.pageNumber);
              }}
            >
              <span className="reader-toc-title">{node.title || t("reader.untitled")}</span>
              {hasPage && <span className="reader-toc-page">{node.pageNumber}</span>}
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
