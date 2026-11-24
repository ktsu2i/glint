import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  BookOpenTextIcon,
  BookmarkSimpleIcon,
  BookmarksSimpleIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CornersInIcon,
  FileIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { type PDFDocumentProxy, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import {
  addBookmark,
  listBookmarks,
  removeBookmark,
  searchBook,
  type BookBookmark,
  type BookFile,
  type BookSearchResult,
} from "../../shared/api/backend";
import { HighlightedExcerpt } from "../../shared/components/HighlightedExcerpt";
import { ToolButton } from "../../shared/components/ToolButton";
import { normalizePageText } from "../../shared/lib/text";
import { LocalizedError, translateLocalizedError } from "../../shared/i18n/error";
import {
  createPdfLoadingTask,
  createPdfTextLayer,
  loadPdfOutline,
  type OutlineNode,
  type PdfTextLayer,
} from "./loadPdf";

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
type BindingDirection = "ltr" | "rtl";
type ReaderPanel = "toc" | "search" | "bookmarks" | null;

const bindingDirectionStorageKey = "glint.reader.bindingDirection";

function loadBindingDirection(bookId: string | undefined): BindingDirection {
  if (!bookId || typeof window === "undefined") {
    return "ltr";
  }
  const stored = window.localStorage.getItem(`${bindingDirectionStorageKey}.${bookId}`);
  return stored === "rtl" ? "rtl" : "ltr";
}

function persistBindingDirection(bookId: string | undefined, direction: BindingDirection) {
  if (!bookId || typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(`${bindingDirectionStorageKey}.${bookId}`, direction);
}

export type ReaderSelection = {
  text: string;
  pageNumber: number;
  startOffset: number;
  endOffset: number;
};

type HighlightRect = {
  pageNumber: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

type PdfReaderProps = {
  book: BookFile | null;
  initialPage?: number;
  selection?: ReaderSelection | null;
  onPageContextChange: (pageNumber: number, text: string, pageCount: number) => void;
  onSelectionChange?: (selection: ReaderSelection | null) => void;
};

export function PdfReader({
  book,
  initialPage = 1,
  selection = null,
  onPageContextChange,
  onSelectionChange,
}: PdfReaderProps) {
  const { t, i18n } = useTranslation();
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const textLayerLeftRef = useRef<HTMLDivElement>(null);
  const textLayerRightRef = useRef<HTMLDivElement>(null);
  const stageObserverRef = useRef<ResizeObserver | null>(null);
  const selectionCallbackRef = useRef(onSelectionChange);
  const pageContextCallbackRef = useRef(onPageContextChange);
  const selectionChangedSincePointerDownRef = useRef(false);

  useEffect(() => {
    selectionCallbackRef.current = onSelectionChange;
  }, [onSelectionChange]);
  useEffect(() => {
    pageContextCallbackRef.current = onPageContextChange;
  }, [onPageContextChange]);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [isEditingPage, setIsEditingPage] = useState(false);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [bindingDirection, setBindingDirection] = useState<BindingDirection>(() =>
    loadBindingDirection(book?.id),
  );
  const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: "fit-page" });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [effectiveScale, setEffectiveScale] = useState(1);
  const [error, setError] = useState("");
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [outlineLoaded, setOutlineLoaded] = useState(false);
  const [openPanel, setOpenPanel] = useState<ReaderPanel>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [bookmarks, setBookmarks] = useState<BookBookmark[]>([]);
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [bookmarkBusyPage, setBookmarkBusyPage] = useState<number | null>(null);
  const [bookmarkError, setBookmarkError] = useState("");
  const [textLayerRevision, setTextLayerRevision] = useState(0);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const [readableText, setReadableText] = useState<{
    pageNumber: number;
    text: string;
  }>({ pageNumber: 0, text: "" });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const isReadingAloudRef = useRef(false);
  const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;
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
    node.addEventListener("wheel", handleWheel, { passive: false });
    wheelCleanupRef.current = () => {
      node.removeEventListener("wheel", handleWheel);
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
      pageContextCallbackRef.current(0, "", 0);
      return;
    }

    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let timedOut = false;
    const abortController = new AbortController();
    const bookUrl = book.url;
    setError("");
    setDocument(null);
    setOutline([]);
    setOutlineLoaded(false);
    setOpenPanel(null);
    setSearchQuery("");
    setSubmittedSearchQuery("");
    setSearchResults([]);
    searchRequestRef.current += 1;
    setIsSearching(false);
    setSearchError("");
    setPageNumber(Math.max(1, initialPage));
    setZoomMode({ kind: "fit-page" });
    setEffectiveScale(1);
    setBindingDirection(loadBindingDirection(book.id));
    pageContextCallbackRef.current(0, "", 0);

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
        setOpenPanel((panel) => (panel === "search" ? null : "search"));
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
    const pdfDocument = document;
    const load = async () => {
      let nodes: OutlineNode[] = [];
      try {
        nodes = await loadPdfOutline(pdfDocument);
      } catch {
        // outline の読み込み失敗時は空の目次として扱う。
      }
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
      } else if (backwardKeys.includes(event.key)) {
        event.preventDefault();
        setPageNumber((current) => Math.max(1, current - step));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [document, viewMode, bindingDirection]);

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
      // 各 page を offscreen canvas に描画し、終わってから表示用 canvas へまとめて転写する。
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

      // Keep the current spread visible while both pages render. Committing both
      // buffers without yielding prevents the right page from flashing behind the left.
      for (const { canvas, context, source } of visibleTargets) {
        canvas.width = source.canvas.width;
        canvas.height = source.canvas.height;
        canvas.style.width = `${Math.floor(source.viewport.width)}px`;
        canvas.style.height = `${Math.floor(source.viewport.height)}px`;
        context.drawImage(source.canvas, 0, 0);
      }
      setEffectiveScale(scale);

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
      pageContextCallbackRef.current(pageNumber, text, pdfDocument.numPages);

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
      setTextLayerRevision((revision) => revision + 1);
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
    function handleSelectionChange() {
      const emit = selectionCallbackRef.current;
      if (!emit) {
        return;
      }
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.isCollapsed) {
        return;
      }
      const anchorParent =
        domSelection.anchorNode instanceof Element
          ? domSelection.anchorNode
          : (domSelection.anchorNode?.parentElement ?? null);
      const focusParent =
        domSelection.focusNode instanceof Element
          ? domSelection.focusNode
          : (domSelection.focusNode?.parentElement ?? null);
      const anchorLayer = anchorParent?.closest<HTMLElement>(".text-layer[data-page]") ?? null;
      const focusLayer = focusParent?.closest<HTMLElement>(".text-layer[data-page]") ?? null;
      if (!anchorLayer || anchorLayer !== focusLayer) {
        return;
      }
      const sourcePage = Number(anchorLayer.dataset.page);
      const range = domSelection.rangeCount > 0 ? domSelection.getRangeAt(0) : null;
      if (
        !range ||
        !anchorLayer.contains(range.startContainer) ||
        !anchorLayer.contains(range.endContainer)
      ) {
        return;
      }
      const rawText = range.toString();
      const text = rawText.trim();
      if (!text || !Number.isFinite(sourcePage) || sourcePage < 1) {
        return;
      }
      const rawStartOffset = getTextOffset(anchorLayer, range.startContainer, range.startOffset);
      const rawEndOffset = getTextOffset(anchorLayer, range.endContainer, range.endOffset);
      const leadingWhitespace = rawText.length - rawText.trimStart().length;
      const trailingWhitespace = rawText.length - rawText.trimEnd().length;
      emit({
        text,
        pageNumber: sourcePage,
        startOffset: rawStartOffset + leadingWhitespace,
        endOffset: rawEndOffset - trailingWhitespace,
      });
      selectionChangedSincePointerDownRef.current = true;
    }

    function handlePointerDown() {
      selectionChangedSincePointerDownRef.current = false;
    }

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".chat-sidebar")) {
        return;
      }
      if (selectionChangedSincePointerDownRef.current) {
        selectionChangedSincePointerDownRef.current = false;
        return;
      }
      selectionCallbackRef.current?.(null);
    }

    window.document.addEventListener("selectionchange", handleSelectionChange);
    window.document.addEventListener("pointerdown", handlePointerDown);
    window.document.addEventListener("click", handleDocumentClick);
    return () => {
      window.document.removeEventListener("selectionchange", handleSelectionChange);
      window.document.removeEventListener("pointerdown", handlePointerDown);
      window.document.removeEventListener("click", handleDocumentClick);
    };
  }, []);

  useLayoutEffect(() => {
    if (!selection) {
      setHighlightRects([]);
      return;
    }

    const layers = [textLayerLeftRef.current, textLayerRightRef.current].filter(
      (layer): layer is HTMLDivElement =>
        !!layer && Number(layer.dataset.page) === selection.pageNumber,
    );
    const rects = layers.flatMap((layer) => getSelectionHighlightRects(layer, selection));
    setHighlightRects(rects);
  }, [selection, textLayerRevision]);

  useEffect(() => {
    selectionCallbackRef.current?.(null);
  }, [pageNumber]);

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
    if (!speechSupported) {
      return;
    }
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      synth.removeEventListener("voiceschanged", load);
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
  const isTocOpen = openPanel === "toc";
  const isSearchOpen = openPanel === "search";
  const isBookmarksOpen = openPanel === "bookmarks";
  const currentPageBookmarked = bookmarks.some((bookmark) => bookmark.pageNumber === pageNumber);

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

  return (
    <section className="reader" aria-label={t("reader.aria")}>
      <div className="reader-toolbar">
        <div className="reader-section-label">
          <ToolButton
            label={isTocOpen ? t("reader.closeToc") : t("reader.openToc")}
            className={isTocOpen ? "is-active" : ""}
            onClick={() => setOpenPanel((panel) => (panel === "toc" ? null : "toc"))}
            disabled={!document}
          >
            <ListBulletsIcon size={15} weight="regular" />
          </ToolButton>
          <ToolButton
            label={isSearchOpen ? t("reader.closeSearch") : t("reader.openSearch")}
            className={isSearchOpen ? "is-active" : ""}
            onClick={() => setOpenPanel((panel) => (panel === "search" ? null : "search"))}
            disabled={!document}
          >
            <MagnifyingGlassIcon size={15} weight="bold" />
          </ToolButton>
          <ToolButton
            label={isBookmarksOpen ? t("reader.closeBookmarks") : t("reader.openBookmarks")}
            className={isBookmarksOpen ? "is-active" : ""}
            onClick={() => setOpenPanel((panel) => (panel === "bookmarks" ? null : "bookmarks"))}
            disabled={!document}
          >
            <BookmarksSimpleIcon size={15} weight="bold" />
          </ToolButton>
        </div>
        <div className="reader-controls" aria-label={t("reader.pageControls")}>
          <ToolButton
            label={isRtlBinding ? t("reader.nextPage") : t("reader.previousPage")}
            disabled={
              isRtlBinding ? !document || pageNumber + step > document.numPages : pageNumber <= 1
            }
            onClick={() =>
              isRtlBinding
                ? setPageNumber((current) =>
                    Math.min(document?.numPages ?? current, current + step),
                  )
                : setPageNumber((current) => Math.max(1, current - step))
            }
          >
            <CaretLeftIcon size={15} weight="bold" />
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
          )}
          <ToolButton
            label={isRtlBinding ? t("reader.previousPage") : t("reader.nextPage")}
            disabled={
              isRtlBinding ? pageNumber <= 1 : !document || pageNumber + step > document.numPages
            }
            onClick={() =>
              isRtlBinding
                ? setPageNumber((current) => Math.max(1, current - step))
                : setPageNumber((current) =>
                    Math.min(document?.numPages ?? current, current + step),
                  )
            }
          >
            <CaretRightIcon size={15} weight="bold" />
          </ToolButton>
          <ToolButton
            label={
              currentPageBookmarked
                ? t("reader.removePageBookmark", { page: pageNumber })
                : t("reader.savePageBookmark", { page: pageNumber })
            }
            className={
              currentPageBookmarked ? "is-active reader-bookmark-toggle" : "reader-bookmark-toggle"
            }
            disabled={!document || bookmarkBusyPage !== null}
            onClick={() => void toggleCurrentPageBookmark()}
          >
            <BookmarkSimpleIcon size={15} weight={currentPageBookmarked ? "fill" : "regular"} />
          </ToolButton>
          <ToolButton
            label={
              speechSupported
                ? isReadingAloud
                  ? t("reader.stopReadAloud")
                  : t("reader.startReadAloud")
                : t("reader.readAloudUnsupported")
            }
            className={isReadingAloud ? "is-active" : ""}
            disabled={!document || !speechSupported}
            onClick={toggleReadAloud}
          >
            {isReadingAloud ? (
              <SpeakerSlashIcon size={15} weight="bold" />
            ) : (
              <SpeakerHighIcon size={15} weight="regular" />
            )}
          </ToolButton>
        </div>
        <div className="zoom-controls" aria-label={t("reader.zoomControls")}>
          <ToolButton
            label={isRtlBinding ? t("reader.bindingSwitchToLtr") : t("reader.bindingSwitchToRtl")}
            className={isRtlBinding ? "is-active" : ""}
            onClick={() =>
              setBindingDirection((current) => {
                const next: BindingDirection = current === "rtl" ? "ltr" : "rtl";
                persistBindingDirection(book?.id, next);
                return next;
              })
            }
          >
            {isRtlBinding ? (
              <ArrowLeftIcon size={14} weight="bold" />
            ) : (
              <ArrowRightIcon size={14} weight="bold" />
            )}
          </ToolButton>
          <ToolButton
            label={viewMode === "spread" ? t("reader.singlePage") : t("reader.spread")}
            className={viewMode === "spread" ? "is-active" : ""}
            onClick={() => setViewMode((current) => (current === "spread" ? "single" : "spread"))}
          >
            {viewMode === "spread" ? (
              <FileIcon size={14} weight="bold" />
            ) : (
              <BookOpenIcon size={14} weight="bold" />
            )}
          </ToolButton>
          <ToolButton
            label={t("reader.fitPage")}
            className={zoomMode.kind === "fit-page" ? "is-active" : ""}
            onClick={() => setZoomMode({ kind: "fit-page" })}
          >
            <CornersInIcon size={14} weight="bold" />
          </ToolButton>
          <ToolButton label={t("reader.zoomOut")} onClick={() => adjustZoom(-manualZoomStep)}>
            <MinusIcon size={14} weight="bold" />
          </ToolButton>
          <span>{Math.round(effectiveScale * 100)}%</span>
          <ToolButton label={t("reader.zoomIn")} onClick={() => adjustZoom(manualZoomStep)}>
            <PlusIcon size={14} weight="bold" />
          </ToolButton>
        </div>
      </div>

      {bookmarkError && (
        <div className="reader-bookmark-error" role="alert">
          {bookmarkError}
        </div>
      )}

      <div className={`reader-body ${openPanel ? "toc-open" : "toc-closed"}`}>
        {isTocOpen && (
          <aside className="reader-toc" aria-label={t("reader.toc")}>
            <div className="reader-toc-header">
              <span>{t("reader.toc")}</span>
            </div>
            <div className="reader-toc-scroll">
              {outline.length === 0 ? (
                <p className="reader-toc-empty">
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
                <MagnifyingGlassIcon size={14} aria-hidden="true" />
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
            </div>
            <div className="reader-search-scroll">
              {searchError ? (
                <p className="reader-search-message is-error" role="alert">
                  {searchError}
                </p>
              ) : submittedSearchQuery ? (
                isSearching ? (
                  <p className="reader-search-message">
                    {t("reader.searchingFor", { query: submittedSearchQuery })}
                  </p>
                ) : searchResults.length === 0 ? (
                  <p className="reader-search-message">
                    {t("reader.noResults", { query: submittedSearchQuery })}
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
                            aria-label={t("reader.goToResult", {
                              page: result.pageNumber,
                            })}
                            onClick={() => jumpToOutlinePage(result.pageNumber)}
                          >
                            <span className="reader-search-result-meta">
                              <strong>PAGE {String(result.pageNumber).padStart(3, "0")}</strong>
                              <span>
                                {t("reader.matches", {
                                  count: result.matchCount,
                                })}
                              </span>
                            </span>
                            <span className="reader-search-excerpt">
                              <HighlightedExcerpt
                                text={result.excerpt}
                                query={submittedSearchQuery}
                              />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </>
                )
              ) : (
                <p className="reader-search-message">{t("reader.searchPrompt")}</p>
              )}
            </div>
          </aside>
        )}
        {isBookmarksOpen && (
          <aside className="reader-toc reader-bookmarks" aria-label={t("reader.bookmarks")}>
            <div className="reader-toc-header">
              <span>{t("reader.bookmarks")}</span>
              {bookmarks.length > 0 && <strong>{bookmarks.length}</strong>}
            </div>
            <div className="reader-toc-scroll">
              {bookmarksLoaded ? (
                bookmarkError && bookmarks.length === 0 ? (
                  <p className="reader-toc-empty is-error">{bookmarkError}</p>
                ) : bookmarks.length === 0 ? (
                  <p className="reader-toc-empty">{t("reader.noBookmarks")}</p>
                ) : (
                  <ol className="reader-bookmark-list">
                    {bookmarks.map((bookmark) => (
                      <li
                        key={bookmark.pageNumber}
                        className={bookmark.pageNumber === pageNumber ? "is-active" : ""}
                      >
                        <button
                          type="button"
                          className="reader-bookmark-link"
                          aria-label={t("reader.goToBookmark", {
                            page: bookmark.pageNumber,
                          })}
                          onClick={() => jumpToOutlinePage(bookmark.pageNumber)}
                        >
                          <BookmarkSimpleIcon size={16} weight="fill" aria-hidden="true" />
                          <span>
                            <strong>
                              {t("reader.bookmarkPage", {
                                page: bookmark.pageNumber,
                              })}
                            </strong>
                            <small>{t("reader.bookmarkSaved")}</small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="reader-bookmark-remove"
                          aria-label={t("reader.removePageBookmark", {
                            page: bookmark.pageNumber,
                          })}
                          disabled={bookmarkBusyPage !== null}
                          onClick={() => {
                            setBookmarkBusyPage(bookmark.pageNumber);
                            setBookmarkError("");
                            void removeBookmark(book.id, bookmark.pageNumber)
                              .then(() =>
                                setBookmarks((current) =>
                                  current.filter(
                                    (entry) => entry.pageNumber !== bookmark.pageNumber,
                                  ),
                                ),
                              )
                              .catch((reason: unknown) =>
                                setBookmarkError(
                                  reason instanceof Error
                                    ? reason.message
                                    : t("error.saveBookmark"),
                                ),
                              )
                              .finally(() => setBookmarkBusyPage(null));
                          }}
                        >
                          <XIcon size={13} weight="bold" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )
              ) : (
                <p className="reader-toc-empty">{t("reader.loadingBookmarks")}</p>
              )}
            </div>
          </aside>
        )}
        <div className="pdf-stage" ref={stageRef}>
          {error && (
            <div className="reader-error" role="alert">
              {error}
            </div>
          )}
          <div
            className={`pdf-spread ${viewMode === "spread" ? "is-spread" : "is-single"}${isRtlBinding ? " is-rtl" : ""}`}
          >
            <div className="pdf-page">
              <canvas
                ref={canvasLeftRef}
                className="pdf-canvas"
                aria-label={t("app.pageLabel", { page: pageNumber })}
              />
              <SelectionHighlight pageNumber={pageNumber} rects={highlightRects} />
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
                <SelectionHighlight pageNumber={rightPageNumber} rects={highlightRects} />
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
        <div className={`reader-page-rail${isRtlBinding ? " is-rtl" : ""}`}>
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
          <div className="reader-slider-bookmarks">
            {document &&
              bookmarks.map((bookmark) => {
                const markerPosition =
                  numPages > 1 ? ((bookmark.pageNumber - 1) / (numPages - 1)) * 100 : 0;
                const isCurrent = bookmark.pageNumber === pageNumber;
                return (
                  <button
                    key={bookmark.pageNumber}
                    type="button"
                    className={`reader-slider-bookmark${isCurrent ? " is-current" : ""}`}
                    style={{ "--bookmark-position": `${markerPosition}%` }}
                    aria-label={t("reader.sliderBookmark", {
                      page: bookmark.pageNumber,
                    })}
                    aria-current={isCurrent ? "page" : undefined}
                    data-tooltip={t("reader.bookmarkPage", {
                      page: bookmark.pageNumber,
                    })}
                    onClick={() => jumpToOutlinePage(bookmark.pageNumber)}
                  >
                    <span className="reader-slider-bookmark-dot" aria-hidden="true" />
                  </button>
                );
              })}
          </div>
        </div>
      </div>
    </section>
  );
}

function detectUtteranceLang(text: string, fallbackUiLang: string): string {
  if (/[぀-ゟ゠-ヿ一-鿿]/.test(text)) {
    return "ja-JP";
  }
  return fallbackUiLang === "ja" ? "ja-JP" : "en-US";
}

function pickVoiceForLang(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) {
    return null;
  }
  const target = lang.toLowerCase();
  const prefix = target.slice(0, 2);
  const exact = voices.find((voice) => voice.lang.toLowerCase() === target);
  if (exact) {
    return exact;
  }
  const sameLanguage = voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
  return sameLanguage ?? null;
}

function getTextOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function getTextBoundary(
  root: HTMLElement,
  targetOffset: number,
): { node: Text; offset: number } | null {
  const showText = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = root.ownerDocument.createTreeWalker(root, showText);
  let consumed = 0;
  let lastTextNode: Text | null = null;

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    if (!(textNode instanceof Text)) {
      continue;
    }
    const nextOffset = consumed + textNode.data.length;
    if (targetOffset <= nextOffset) {
      return { node: textNode, offset: Math.max(0, targetOffset - consumed) };
    }
    consumed = nextOffset;
    lastTextNode = textNode;
  }

  return targetOffset === consumed && lastTextNode
    ? { node: lastTextNode, offset: lastTextNode.data.length }
    : null;
}

function getSelectionHighlightRects(
  layer: HTMLElement,
  selection: ReaderSelection,
): HighlightRect[] {
  const start = getTextBoundary(layer, selection.startOffset);
  const end = getTextBoundary(layer, selection.endOffset);
  if (!start || !end) {
    return [];
  }

  const range = layer.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  if (range.toString().trim() !== selection.text) {
    return [];
  }

  const layerRect = layer.getBoundingClientRect();
  const rawRects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      pageNumber: selection.pageNumber,
      left: rect.left - layerRect.left,
      top: rect.top - layerRect.top,
      width: rect.width,
      height: rect.height,
    }))
    .toSorted((a, b) => a.top - b.top || a.left - b.left);

  return rawRects.reduce<HighlightRect[]>((merged, rect) => {
    const previous = merged.at(-1);
    const sameLine =
      previous !== undefined &&
      Math.abs(previous.top - rect.top) <= 2 &&
      Math.abs(previous.height - rect.height) <= 3;
    const touchesPrevious =
      previous !== undefined && rect.left <= previous.left + previous.width + 3;
    if (previous && sameLine && touchesPrevious) {
      previous.width =
        Math.max(previous.left + previous.width, rect.left + rect.width) - previous.left;
      previous.height = Math.max(previous.height, rect.height);
      return merged;
    }
    merged.push(rect);
    return merged;
  }, []);
}

function SelectionHighlight({ pageNumber, rects }: { pageNumber: number; rects: HighlightRect[] }) {
  const pageRects = rects.filter((rect) => rect.pageNumber === pageNumber);
  return (
    <div className="context-highlight-layer" aria-hidden="true">
      {pageRects.map((rect, index) => (
        <span
          // oxlint-disable-next-line react/no-array-index-key -- 同一座標の rect が重なり得るため index を併用する。
          key={`${rect.left}-${rect.top}-${index}`}
          className="context-highlight-segment"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </div>
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
