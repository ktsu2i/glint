import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextAaIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { FoliateRelocateDetail, FoliateShowAnnotationDetail, View } from "foliate-js/view.js";
import {
  addBookmark,
  addHighlight,
  changeHighlightColor,
  getReaderSettings,
  listBookmarks,
  listHighlights,
  removeBookmark,
  removeHighlight,
  saveReaderSettings,
  searchBook,
  type BookBookmark,
  type BookHighlight,
  type EpubLayout,
  type HighlightColor,
  type ReaderSettings,
} from "./api";
import type { BookFile, BookSearchResult } from "../../shared/api/books";
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
import {
  EPUB_FONT_SCALE_STEP,
  EPUB_MAX_FONT_SCALE,
  EPUB_MIN_FONT_SCALE,
  defaultReaderSettings,
  epubHighlightFills,
  epubStyles,
  flattenToc,
  guardEpubContent,
  isCFIOnPage,
  pageStartCFI,
  rangeSpeechText,
  sortEpubBookmarks,
  sortEpubHighlights,
  type EpubTheme,
  type EpubTocLine,
} from "./epubContent";
import { createFoliateView } from "./foliate";
import {
  detectUtteranceLang,
  isSpeechSupported,
  pickVoiceForLang,
  useSpeechVoices,
} from "./speech";

/** Where a floating toolbar points, in the reader's coordinates, with the reader's width. */
type FloatingAnchor = { x: number; top: number; bottom: number; width: number };

type PendingSelection = FloatingAnchor & {
  cfi: string;
  text: string;
  section: number;
  doc: Document;
};

type ActiveHighlight = FloatingAnchor & { id: number };

type ReaderLocation = {
  /** The range CFI of what the page shows. */
  cfi: string;
  fraction: number;
  section: number;
  sectionCount: number;
  tocHref: string;
  tocLabel: string;
};

type ReaderHandlers = {
  handleKeyDown: (event: KeyboardEvent) => void;
  handleWheel: (event: WheelEvent) => void;
  handleClick: (event: MouseEvent) => void;
  handleSelection: (doc: Document, index: number) => void;
  handleAnnotation: (detail: FoliateShowAnnotationDetail) => void;
  clearSelection: () => void;
};

type TurnDirection = "left" | "right" | "next" | "prev";

function progressPercent(bookmark: BookBookmark): number {
  return Math.round(bookmark.progress * 100);
}

// A trackpad swipe or a wheel turn longer than this turns one page.
const wheelTurnThreshold = 60;
const wheelCooldownMilliseconds = 450;
const sliderSteps = 1000;

const keyDirections: Partial<Record<string, TurnDirection>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  PageDown: "next",
  PageUp: "prev",
};

function currentTheme(): EpubTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Follows the app theme, which the settings window can change at any time. */
function useDocumentTheme(): EpubTheme {
  const [theme, setTheme] = useState<EpubTheme>(currentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

// Events from a section carry elements of another window, so instanceof checks fail on them.
function isElementLike(target: EventTarget | null): target is Element {
  return target !== null && "tagName" in target && "closest" in target;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!isElementLike(target)) {
    return false;
  }
  return (
    ("isContentEditable" in target && target.isContentEditable === true) ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * Places a range from a section in the reader's coordinates. The section is in
 * a frame, so its position is added to the range's.
 */
function rangeAnchor(range: Range, reader: HTMLElement | null): FloatingAnchor | null {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
  if (!reader || !frame) {
    return null;
  }
  const box = range.getBoundingClientRect();
  const frameBox = frame.getBoundingClientRect();
  const readerBox = reader.getBoundingClientRect();
  return {
    x: frameBox.left + box.left + box.width / 2 - readerBox.left,
    top: frameBox.top + box.top - readerBox.top,
    bottom: frameBox.top + box.bottom - readerBox.top,
    width: readerBox.width,
  };
}

type EpubReaderProps = {
  book: BookFile;
  /** The section to open, counted from 1. */
  initialSection?: number;
  /** Reports the section on screen and the CFI of the page in it. */
  onPageChange: (section: number, sectionCount: number, cfi: string) => void;
  onBack?: () => void;
};

/** The text size and layout every EPUB shares. */
async function loadReaderSettings(): Promise<ReaderSettings> {
  try {
    return await getReaderSettings();
  } catch (reason) {
    console.warn("Loading the reader settings failed", reason);
    return defaultReaderSettings;
  }
}

function persistReaderSettings(settings: ReaderSettings) {
  saveReaderSettings(settings).catch((reason: unknown) => {
    console.warn("Saving the reader settings failed", reason);
  });
}

export function EpubReader({ book, initialSection = 1, onPageChange, onBack }: EpubReaderProps) {
  const initialCfi = book.initialCfi ?? "";
  const { t, i18n } = useTranslation();
  const theme = useDocumentTheme();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [toc, setToc] = useState<EpubTocLine[]>([]);
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [fontScale, setFontScale] = useState(defaultReaderSettings.epubFontScale);
  const { openPanel, setOpenPanel, togglePanel } = useReaderPanel();
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isTopbarHovered, setIsTopbarHovered] = useState(false);
  const [isTopbarFocused, setIsTopbarFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [layout, setLayout] = useState<EpubLayout>(defaultReaderSettings.epubLayout);
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  const [highlightsLoaded, setHighlightsLoaded] = useState(false);
  const [highlightBusy, setHighlightBusy] = useState(false);
  const [highlightError, setHighlightError] = useState("");
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<ActiveHighlight | null>(null);
  const [placeLabels, setPlaceLabels] = useState<Record<string, string>>({});
  const [bookmarks, setBookmarks] = useState<BookBookmark[]>([]);
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarkError, setBookmarkError] = useState("");
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const speechSupported = isSpeechSupported();
  const voices = useSpeechVoices(speechSupported);

  const readerRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // foliate-js asks for highlights while it draws a section, outside React's
  // render, so it reads them here.
  const highlightsRef = useRef<BookHighlight[]>([]);
  // A click on a highlight also reaches the page's click handler first.
  const annotationHitRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const pageChangeCallbackRef = useRef(onPageChange);
  const translateRef = useRef(t);
  // Listeners on the stage and inside each section are attached once, so they
  // call through this ref, which always holds the current handlers.
  const handlersRef = useRef<ReaderHandlers | null>(null);
  // The text on the page, read aloud from here.
  const pageRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    pageChangeCallbackRef.current = onPageChange;
    translateRef.current = t;
  }, [onPageChange, t]);

  // Opens the book in a foliate-js view and lands where the reader stopped.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    let active = true;
    let opened: View | null = null;

    const handleRelocate = (detail: FoliateRelocateDetail) => {
      const section = (detail.section?.current ?? 0) + 1;
      const sectionCount = detail.section?.total ?? 0;
      setPendingSelection(null);
      setActiveHighlight(null);
      pageRangeRef.current = detail.range ?? null;
      setLocation((previous) => ({
        cfi: detail.cfi,
        // The first report of a section can come before its pages are counted.
        fraction: Number.isFinite(detail.fraction) ? detail.fraction : (previous?.fraction ?? 0),
        section,
        sectionCount,
        tocHref: detail.tocItem?.href ?? "",
        tocLabel: (detail.tocItem?.label ?? "").trim(),
      }));
      if (sectionCount > 0) {
        pageChangeCallbackRef.current(section, sectionCount, detail.cfi);
      }
    };

    const open = async () => {
      const [{ view: foliate, drawHighlight }, settings] = await Promise.all([
        createFoliateView(),
        loadReaderSettings(),
      ]);
      if (!active) {
        return;
      }
      setFontScale(settings.epubFontScale);
      setLayout(settings.epubLayout);
      opened = foliate;
      foliate.className = "epub-view";
      foliate.style.setProperty("--overlayer-highlight-opacity", "0.32");
      foliate.addEventListener("relocate", (event) => handleRelocate(event.detail));
      foliate.addEventListener("load", ({ detail: { doc, index } }) => {
        doc.addEventListener("keydown", (event) => handlersRef.current?.handleKeyDown(event));
        doc.addEventListener("wheel", (event) => handlersRef.current?.handleWheel(event), {
          passive: true,
        });
        doc.addEventListener("click", (event) => handlersRef.current?.handleClick(event));
        doc.addEventListener("mouseup", () => handlersRef.current?.handleSelection(doc, index));
        doc.addEventListener("selectionchange", () => {
          const selection = doc.getSelection();
          if (!selection || selection.isCollapsed) {
            handlersRef.current?.clearSelection();
          }
        });
      });
      // Each section gets its own overlay; draw the section's highlights on it.
      foliate.addEventListener("create-overlay", ({ detail: { index } }) => {
        for (const highlight of highlightsRef.current) {
          if (highlight.pageNumber === index + 1 && highlight.cfi) {
            void foliate.addAnnotation({ value: highlight.cfi });
          }
        }
      });
      foliate.addEventListener("draw-annotation", ({ detail: { draw, annotation } }) => {
        const highlight = highlightsRef.current.find((entry) => entry.cfi === annotation.value);
        draw(drawHighlight, { color: epubHighlightFills[highlight?.color ?? "yellow"] });
      });
      foliate.addEventListener("show-annotation", ({ detail }) =>
        handlersRef.current?.handleAnnotation(detail),
      );
      // Glint makes no requests beyond its own; links out of the book stay closed.
      foliate.addEventListener("external-link", (event) => event.preventDefault());
      stage.append(foliate);

      await foliate.open(book.url);
      if (!active) {
        return;
      }
      if (foliate.book?.transformTarget) {
        guardEpubContent(foliate.book.transformTarget);
      }
      const renderer = foliate.renderer;
      if (renderer) {
        renderer.setAttribute("flow", "paginated");
        renderer.setAttribute("margin", "56px");
        renderer.setAttribute("gap", "6%");
        renderer.setAttribute("max-inline-size", "720px");
        renderer.setAttribute("max-column-count", settings.epubLayout === "spread" ? "2" : "1");
      }
      setToc(flattenToc(foliate.book?.toc));
      setView(foliate);

      // The CFI is the place in the section the book was left on.
      if (initialCfi) {
        await foliate.init({ lastLocation: initialCfi });
      } else if (initialSection > 1) {
        await foliate.goTo(initialSection - 1);
      } else {
        await foliate.init({ showTextStart: true });
      }
    };

    open().catch((reason: unknown) => {
      if (active) {
        console.warn("Opening the EPUB failed", reason);
        setError(translateRef.current("error.openEpub"));
      }
    });

    return () => {
      active = false;
      opened?.close();
      opened?.remove();
    };
  }, [book.url, initialCfi, initialSection]);

  useEffect(() => {
    view?.renderer?.setStyles(epubStyles(fontScale, theme));
  }, [view, fontScale, theme]);

  // A spread shows two pages when the window is wide enough; a single page never does.
  useEffect(() => {
    view?.renderer?.setAttribute("max-column-count", layout === "spread" ? "2" : "1");
  }, [view, layout]);

  useLayoutEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const saved = sortEpubHighlights(await listHighlights(book.id));
        if (active) {
          highlightsRef.current = saved;
          setHighlights(saved);
          setHighlightsLoaded(true);
        }
      } catch (reason: unknown) {
        if (active) {
          setHighlightsLoaded(true);
          setHighlightError(
            reason instanceof Error ? reason.message : translateRef.current("error.loadHighlights"),
          );
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [book.id]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const saved = sortEpubBookmarks(await listBookmarks(book.id));
        if (active) {
          setBookmarks(saved);
          setBookmarksLoaded(true);
        }
      } catch (reason: unknown) {
        if (active) {
          setBookmarksLoaded(true);
          setBookmarkError(
            reason instanceof Error ? reason.message : translateRef.current("error.loadBookmarks"),
          );
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [book.id]);

  // Highlights that arrive after the first section was drawn are added to it now.
  useEffect(() => {
    if (!view || !highlightsLoaded) {
      return;
    }
    for (const highlight of highlightsRef.current) {
      if (highlight.cfi) {
        view.addAnnotation({ value: highlight.cfi }).catch(() => {});
      }
    }
  }, [view, highlightsLoaded]);

  // The lists name each highlight and bookmark after the table of contents
  // entry it falls under.
  useEffect(() => {
    if ((openPanel !== "highlights" && openPanel !== "bookmarks") || !view) {
      return;
    }
    let active = true;
    const places = openPanel === "highlights" ? highlights : bookmarks;
    const missing = [...new Set(places.map((place) => place.cfi))].filter(
      (cfi) => !(cfi in placeLabels),
    );
    const label = async () => {
      const found: Record<string, string> = {};
      for (const cfi of missing) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 1件ずつ section を読み込むので順番に行う。
        const item = await view.getTOCItemOf(cfi).catch(() => null);
        found[cfi] = (item?.label ?? "").trim();
      }
      if (active && missing.length > 0) {
        setPlaceLabels((current) => ({ ...current, ...found }));
      }
    };
    void label();
    return () => {
      active = false;
    };
  }, [openPanel, view, highlights, bookmarks, placeLabels]);

  // Reads the page aloud, then turns to the next one and reads on.
  const pageCFI = location?.cfi ?? "";
  useEffect(() => {
    if (!speechSupported || !isReadingAloud || !view || !pageCFI) {
      return;
    }
    let cancelled = false;
    const synth = window.speechSynthesis;
    const readOn = () => {
      if (cancelled) {
        return;
      }
      if (view.renderer?.atEnd === true) {
        setIsReadingAloud(false);
        return;
      }
      view.next().catch(() => setIsReadingAloud(false));
    };
    const range = pageRangeRef.current;
    const text = range ? rangeSpeechText(range) : "";
    if (!text) {
      // A page with only pictures has nothing to read.
      readOn();
      return () => {
        cancelled = true;
      };
    }
    const lang = detectUtteranceLang(text, i18n.language);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const voice = pickVoiceForLang(voices, lang);
    if (voice) {
      utterance.voice = voice;
    }
    utterance.addEventListener("end", readOn);
    utterance.addEventListener("error", () => {
      if (!cancelled) {
        setIsReadingAloud(false);
      }
    });
    synth.cancel();
    synth.speak(utterance);
    return () => {
      // Cancelling ends the utterance, which must not turn the page.
      cancelled = true;
      synth.cancel();
    };
  }, [i18n.language, isReadingAloud, pageCFI, speechSupported, view, voices]);

  useEffect(() => {
    if (!speechSupported) {
      return;
    }
    return () => window.speechSynthesis.cancel();
  }, [speechSupported]);

  const toggleChrome = useCallback(() => {
    if (openPanel || isViewMenuOpen) {
      setOpenPanel(null);
      setIsViewMenuOpen(false);
      return;
    }
    setChromeVisible((current) => !current);
  }, [isViewMenuOpen, openPanel, setOpenPanel]);

  const turnPage = useCallback(
    (direction: TurnDirection) => {
      if (!view) {
        return;
      }
      const turn =
        direction === "left"
          ? view.goLeft()
          : direction === "right"
            ? view.goRight()
            : direction === "next"
              ? view.next()
              : view.prev();
      turn.catch(() => {});
    },
    [view],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        togglePanel("search");
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) {
        return;
      }
      const direction = keyDirections[event.key];
      if (direction) {
        event.preventDefault();
        turnPage(direction);
        setChromeVisible(false);
      } else if (event.key === "Escape") {
        if (pendingSelection || activeHighlight) {
          pendingSelection?.doc.getSelection()?.removeAllRanges();
          setPendingSelection(null);
          setActiveHighlight(null);
        } else {
          toggleChrome();
        }
      }
    },
    [activeHighlight, pendingSelection, toggleChrome, togglePanel, turnPage],
  );

  const wheelRef = useRef({ total: 0, lockedUntil: 0 });
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey) {
        return;
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const state = wheelRef.current;
      const now = performance.now();
      if (now < state.lockedUntil) {
        state.total = 0;
        return;
      }
      state.total += delta;
      if (Math.abs(state.total) < wheelTurnThreshold) {
        return;
      }
      turnPage(state.total > 0 ? "next" : "prev");
      state.total = 0;
      state.lockedUntil = now + wheelCooldownMilliseconds;
    },
    [turnPage],
  );

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (!isElementLike(event.target)) {
        return;
      }
      // foliate-js follows links itself.
      if (event.target.closest("a[href]") !== null) {
        return;
      }
      const selection = event.target.ownerDocument.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim() !== "") {
        return;
      }
      // foliate-js reports a click on a highlight after this handler; wait for it.
      annotationHitRef.current = false;
      window.setTimeout(() => {
        if (annotationHitRef.current) {
          annotationHitRef.current = false;
          return;
        }
        if (activeHighlight) {
          setActiveHighlight(null);
          return;
        }
        toggleChrome();
      }, 0);
    },
    [activeHighlight, toggleChrome],
  );

  const handleSelection = useCallback(
    (doc: Document, index: number) => {
      const selection = doc.getSelection();
      if (!view || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      const text = range.toString().trim();
      const anchor = rangeAnchor(range, readerRef.current);
      if (!text || !anchor) {
        return;
      }
      let cfi: string;
      try {
        cfi = view.getCFI(index, range);
      } catch {
        return;
      }
      setActiveHighlight(null);
      setPendingSelection({ ...anchor, cfi, text, section: index + 1, doc });
    },
    [view],
  );

  const handleAnnotation = useCallback((detail: FoliateShowAnnotationDetail) => {
    const highlight = highlightsRef.current.find((entry) => entry.cfi === detail.value);
    const anchor = rangeAnchor(detail.range, readerRef.current);
    if (!highlight || !anchor) {
      return;
    }
    annotationHitRef.current = true;
    setPendingSelection(null);
    setActiveHighlight({ ...anchor, id: highlight.id });
  }, []);

  const clearSelection = useCallback(() => setPendingSelection(null), []);

  useLayoutEffect(() => {
    handlersRef.current = {
      handleKeyDown,
      handleWheel,
      handleClick,
      handleSelection,
      handleAnnotation,
      clearSelection,
    };
  }, [handleKeyDown, handleWheel, handleClick, handleSelection, handleAnnotation, clearSelection]);

  useEffect(() => {
    const stage = stageRef.current;
    const onKeyDown = (event: KeyboardEvent) => handlersRef.current?.handleKeyDown(event);
    const onWheel = (event: WheelEvent) => handlersRef.current?.handleWheel(event);
    window.addEventListener("keydown", onKeyDown);
    stage?.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stage?.removeEventListener("wheel", onWheel);
    };
  }, []);

  useEffect(() => {
    if (openPanel === "search") {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [openPanel]);

  const submitBookSearch = useCallback(async () => {
    const query = searchQuery.trim();
    view?.clearSearch();
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
  }, [book.id, searchQuery, t, view]);

  /** Opens a section from the search, on the first match foliate-js finds in it. */
  async function openSearchResult(section: number) {
    if (!view) {
      return;
    }
    let target: string | number = section - 1;
    view.clearSearch();
    try {
      for await (const found of view.search({ query: submittedSearchQuery, index: section - 1 })) {
        if (found === "done") {
          break;
        }
        if ("cfi" in found) {
          target = found.cfi;
          break;
        }
      }
    } catch (reason) {
      console.warn("Finding the match in the section failed", reason);
    }
    await view.goTo(target);
  }

  async function saveSelectionHighlight(color: HighlightColor) {
    if (!view || !pendingSelection || highlightBusy) {
      return;
    }
    const selection = pendingSelection;
    setHighlightBusy(true);
    setHighlightError("");
    try {
      const saved = await addHighlight(book.id, {
        pageNumber: selection.section,
        pageCount: Math.max(selection.section, location?.sectionCount ?? 0),
        color,
        text: selection.text,
        rects: [],
        cfi: selection.cfi,
      });
      const next = sortEpubHighlights([...highlightsRef.current, saved]);
      highlightsRef.current = next;
      setHighlights(next);
      await view.addAnnotation({ value: saved.cfi });
      selection.doc.getSelection()?.removeAllRanges();
      setPendingSelection(null);
    } catch (reason: unknown) {
      setHighlightError(reason instanceof Error ? reason.message : t("error.saveHighlight"));
    } finally {
      setHighlightBusy(false);
    }
  }

  async function recolorHighlight(id: number, color: HighlightColor) {
    if (!view || highlightBusy) {
      return;
    }
    setHighlightBusy(true);
    setHighlightError("");
    try {
      const changed = await changeHighlightColor(book.id, id, color);
      const next = highlightsRef.current.map((entry) => (entry.id === id ? changed : entry));
      highlightsRef.current = next;
      setHighlights(next);
      // Adding it again redraws it in the new color.
      await view.addAnnotation({ value: changed.cfi });
    } catch (reason: unknown) {
      setHighlightError(reason instanceof Error ? reason.message : t("error.saveHighlight"));
    } finally {
      setHighlightBusy(false);
    }
  }

  async function deleteHighlight(id: number) {
    const highlight = highlightsRef.current.find((entry) => entry.id === id);
    if (!view || !highlight || highlightBusy) {
      return;
    }
    setHighlightBusy(true);
    setHighlightError("");
    try {
      await removeHighlight(book.id, id);
      const next = highlightsRef.current.filter((entry) => entry.id !== id);
      highlightsRef.current = next;
      setHighlights(next);
      setActiveHighlight(null);
      await view.deleteAnnotation({ value: highlight.cfi });
    } catch (reason: unknown) {
      setHighlightError(reason instanceof Error ? reason.message : t("error.saveHighlight"));
    } finally {
      setHighlightBusy(false);
    }
  }

  const pageBookmarks = pageCFI
    ? bookmarks.filter((bookmark) => isCFIOnPage(bookmark.cfi, pageCFI))
    : [];
  const pageBookmarked = pageBookmarks.length > 0;

  async function togglePageBookmark() {
    if (!location || bookmarkBusy) {
      return;
    }
    setBookmarkBusy(true);
    setBookmarkError("");
    try {
      if (pageBookmarked) {
        await Promise.all(
          pageBookmarks.map((bookmark) =>
            removeBookmark(book.id, bookmark.pageNumber, bookmark.cfi),
          ),
        );
        setBookmarks((current) => current.filter((bookmark) => !pageBookmarks.includes(bookmark)));
      } else {
        const saved = await addBookmark(
          book.id,
          location.section,
          Math.max(location.section, location.sectionCount),
          {
            cfi: pageStartCFI(location.cfi),
            progress: Math.min(1, Math.max(0, location.fraction)),
          },
        );
        setBookmarks((current) =>
          sortEpubBookmarks([...current.filter((bookmark) => bookmark.cfi !== saved.cfi), saved]),
        );
      }
    } catch (reason: unknown) {
      setBookmarkError(reason instanceof Error ? reason.message : t("error.saveBookmark"));
    } finally {
      setBookmarkBusy(false);
    }
  }

  async function deleteBookmark(bookmark: BookBookmark) {
    if (bookmarkBusy) {
      return;
    }
    setBookmarkBusy(true);
    setBookmarkError("");
    try {
      await removeBookmark(book.id, bookmark.pageNumber, bookmark.cfi);
      setBookmarks((current) => current.filter((entry) => entry !== bookmark));
    } catch (reason: unknown) {
      setBookmarkError(reason instanceof Error ? reason.message : t("error.saveBookmark"));
    } finally {
      setBookmarkBusy(false);
    }
  }

  function toggleReadAloud() {
    if (!speechSupported) {
      return;
    }
    if (isReadingAloud) {
      window.speechSynthesis.cancel();
    }
    setIsReadingAloud(!isReadingAloud);
  }

  function changeLayout(next: EpubLayout) {
    setLayout(next);
    persistReaderSettings({ epubFontScale: fontScale, epubLayout: next });
  }

  function changeFontScale(next: number) {
    const clamped = Math.min(EPUB_MAX_FONT_SCALE, Math.max(EPUB_MIN_FONT_SCALE, next));
    setFontScale(clamped);
    persistReaderSettings({ epubFontScale: clamped, epubLayout: layout });
  }

  const chromeShown = chromeVisible || openPanel !== null || isViewMenuOpen;
  const windowControlsShown = chromeShown || isTopbarHovered || isTopbarFocused;
  useEffect(() => {
    showWindowControls(windowControlsShown);
  }, [windowControlsShown]);
  useEffect(() => () => showWindowControls(true), []);

  const isReady = view !== null && location !== null;
  const percent = Math.round((location?.fraction ?? 0) * 100);
  const sliderValue = Math.round((location?.fraction ?? 0) * sliderSteps);
  const selectedHighlight = activeHighlight
    ? highlights.find((entry) => entry.id === activeHighlight.id)
    : undefined;
  const placeName = (place: { cfi: string; pageNumber: number }) =>
    placeLabels[place.cfi] || t("reader.sectionNumber", { number: place.pageNumber });
  const isRtl = view?.book?.dir === "rtl";
  const sectionLabel = location?.tocLabel ?? "";

  return (
    <section
      ref={readerRef}
      className={`reader ambient epub-reader${chromeShown ? " is-chrome-visible" : ""}`}
      aria-label={t("reader.epubAria")}
    >
      <div className="reader-drag-region" aria-hidden="true" />

      <div className={`epub-stage${isReady ? "" : " is-loading"}`} ref={stageRef} />
      {error && (
        <div className="reader-error" role="alert">
          {error}
        </div>
      )}

      {isReady && (
        <p className="reader-status" aria-hidden="true">
          {sectionLabel ? `${sectionLabel} · ${percent}%` : `${percent}%`}
        </p>
      )}

      <ReaderTopBar
        ready={isReady}
        title={book.title}
        subtitle={sectionLabel || null}
        openPanel={openPanel}
        onTogglePanel={togglePanel}
        readAloud={{
          supported: speechSupported,
          active: isReadingAloud,
          onToggle: toggleReadAloud,
        }}
        bookmark={{
          label: pageBookmarked ? t("reader.removeBookmarkHere") : t("reader.saveBookmarkHere"),
          active: pageBookmarked,
          disabled: bookmarkBusy,
          onToggle: () => void togglePageBookmark(),
        }}
        viewMenu={{
          open: isViewMenuOpen,
          icon: <TextAaIcon size={17} weight="regular" />,
          onToggle: () => setIsViewMenuOpen((current) => !current),
        }}
        onHoverChange={setIsTopbarHovered}
        onFocusChange={setIsTopbarFocused}
        onBack={onBack}
      />

      {isViewMenuOpen && (
        <ReaderViewMenu>
          <LayoutSection
            layout={layout}
            note={t("reader.epubSpreadNote")}
            onChange={changeLayout}
          />
          <ScaleSection
            heading={t("reader.textSize")}
            value={`${fontScale}%`}
            decrease={{
              label: t("reader.smallerText"),
              disabled: fontScale <= EPUB_MIN_FONT_SCALE,
              onClick: () => changeFontScale(fontScale - EPUB_FONT_SCALE_STEP),
            }}
            increase={{
              label: t("reader.largerText"),
              disabled: fontScale >= EPUB_MAX_FONT_SCALE,
              onClick: () => changeFontScale(fontScale + EPUB_FONT_SCALE_STEP),
            }}
            reset={{
              label: t("reader.defaultTextSize"),
              pressed: fontScale === 100,
              onClick: () => changeFontScale(100),
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
          style={floatingStyle(pendingSelection, pendingSelection.width)}
          busy={highlightBusy}
          onPick={(color) => void saveSelectionHighlight(color)}
        />
      )}

      {activeHighlight && selectedHighlight && (
        <HighlightActionsToolbar
          style={floatingStyle(activeHighlight, activeHighlight.width)}
          color={selectedHighlight.color}
          busy={highlightBusy}
          onRecolor={(color) => void recolorHighlight(selectedHighlight.id, color)}
          onRemove={() => void deleteHighlight(selectedHighlight.id)}
        />
      )}

      {openPanel && (
        <ReaderSheet
          panel={openPanel}
          count={
            openPanel === "highlights"
              ? highlights.length
              : openPanel === "bookmarks"
                ? bookmarks.length
                : 0
          }
          onClose={() => setOpenPanel(null)}
        >
          {openPanel === "toc" && (
            <div className="reader-sheet-scroll">
              {toc.length === 0 ? (
                <p className="reader-sheet-message">{t("reader.noToc")}</p>
              ) : (
                <ul className="reader-toc-list">
                  {toc.map((line) => (
                    <li key={line.key}>
                      <button
                        type="button"
                        className={`reader-toc-item${line.href === location?.tocHref ? " is-active" : ""}`}
                        style={{ paddingLeft: `${10 + line.depth * 14}px` }}
                        onClick={() => void view?.goTo(line.href)}
                      >
                        <span className="reader-toc-title">
                          {line.label || t("reader.untitled")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {openPanel === "bookmarks" && (
            <BookmarkList
              loaded={bookmarksLoaded}
              error={bookmarkError}
              busy={bookmarkBusy}
              emptyMessage={t("reader.noEpubBookmarks")}
              entries={bookmarks.map((bookmark) => ({
                key: bookmark.cfi,
                active: pageBookmarks.includes(bookmark),
                title: placeName(bookmark),
                detail: `${progressPercent(bookmark)}%`,
                goLabel: t("reader.goToBookmarkIn", { place: placeName(bookmark) }),
                removeLabel: t("reader.removeBookmarkIn", { place: placeName(bookmark) }),
                onGo: () => void view?.goTo(bookmark.cfi),
                onRemove: () => void deleteBookmark(bookmark),
              }))}
            />
          )}
          {openPanel === "highlights" && (
            <HighlightList
              loaded={highlightsLoaded}
              // The error shows above the page; the list stays as it was.
              error=""
              busy={highlightBusy}
              entries={highlights.map((highlight) => ({
                key: highlight.id,
                color: highlight.color,
                active: highlight.pageNumber === location?.section,
                place: placeName(highlight),
                text: highlight.text,
                goLabel: t("reader.goToHighlightIn", { place: placeName(highlight) }),
                removeLabel: t("reader.removeHighlightIn", { place: placeName(highlight) }),
                onGo: () => void view?.goTo(highlight.cfi),
                onRemove: () => void deleteHighlight(highlight.id),
              }))}
            />
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
              describeResult={(result) => {
                const title =
                  result.headingPath || t("reader.sectionNumber", { number: result.pageNumber });
                return {
                  title,
                  label: t("reader.goToSection", { title }),
                  active: result.pageNumber === location?.section,
                };
              }}
              onSelectResult={(result) => void openSearchResult(result.pageNumber)}
            />
          )}
        </ReaderSheet>
      )}

      <ReaderBottomBar
        left={{
          label: isRtl ? t("reader.nextPage") : t("reader.previousPage"),
          disabled: !isReady,
          onClick: () => turnPage("left"),
        }}
        right={{
          label: isRtl ? t("reader.previousPage") : t("reader.nextPage"),
          disabled: !isReady,
          onClick: () => turnPage("right"),
        }}
        counter={<span className="page-count epub-page-count">{percent}%</span>}
        rtl={isRtl}
        slider={
          <input
            type="range"
            min={0}
            max={sliderSteps}
            step={1}
            value={sliderValue}
            aria-label={t("reader.progressSlider")}
            aria-valuetext={`${percent}%`}
            disabled={!isReady}
            dir={isRtl ? "rtl" : "ltr"}
            style={{ "--page-progress": `${sliderValue / (sliderSteps / 100)}%` }}
            onChange={(event) => void view?.goToFraction(Number(event.target.value) / sliderSteps)}
          />
        }
        markers={
          isReady
            ? bookmarks.map((bookmark) => {
                const place = `${placeName(bookmark)} · ${progressPercent(bookmark)}%`;
                return {
                  key: bookmark.cfi,
                  position: bookmark.progress * 100,
                  current: pageBookmarks.includes(bookmark),
                  label: t("reader.goToBookmarkIn", { place }),
                  tooltip: place,
                  onGo: () => void view?.goTo(bookmark.cfi),
                };
              })
            : []
        }
      />
    </section>
  );
}
