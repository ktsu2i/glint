import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  TextAaIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { FoliateRelocateDetail, View } from "foliate-js/view.js";
import {
  searchBook,
  setWindowControlsVisible,
  type BookFile,
  type BookSearchResult,
} from "../../shared/api/backend";
import { HighlightedExcerpt } from "../../shared/components/HighlightedExcerpt";
import { ToolButton } from "../../shared/components/ToolButton";
import {
  EPUB_FONT_SCALE_STEP,
  EPUB_MAX_FONT_SCALE,
  EPUB_MIN_FONT_SCALE,
  epubStyles,
  flattenToc,
  guardEpubContent,
  loadEpubFontScale,
  loadEpubPosition,
  saveEpubFontScale,
  saveEpubPosition,
  type EpubTheme,
  type EpubTocLine,
} from "./epubContent";
import { createFoliateView } from "./foliate";

type ReaderPanel = "toc" | "search" | null;

type ReaderLocation = {
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
};

type TurnDirection = "left" | "right" | "next" | "prev";

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

function showWindowControls(visible: boolean) {
  void setWindowControlsVisible(visible).catch(() => {});
}

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

type EpubReaderProps = {
  book: BookFile;
  /** The section to open, counted from 1. */
  initialSection?: number;
  onPageChange: (section: number, sectionCount: number) => void;
  onBack?: () => void;
};

export function EpubReader({ book, initialSection = 1, onPageChange, onBack }: EpubReaderProps) {
  const { t } = useTranslation();
  const theme = useDocumentTheme();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [toc, setToc] = useState<EpubTocLine[]>([]);
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [fontScale, setFontScale] = useState(loadEpubFontScale);
  const [openPanel, setOpenPanel] = useState<ReaderPanel>(null);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isTopbarHovered, setIsTopbarHovered] = useState(false);
  const [isTopbarFocused, setIsTopbarFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const stageRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const pageChangeCallbackRef = useRef(onPageChange);
  const translateRef = useRef(t);
  // Listeners on the stage and inside each section are attached once, so they
  // call through this ref, which always holds the current handlers.
  const handlersRef = useRef<ReaderHandlers | null>(null);

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
    const bookId = book.id;

    const handleRelocate = (detail: FoliateRelocateDetail) => {
      const section = (detail.section?.current ?? 0) + 1;
      const sectionCount = detail.section?.total ?? 0;
      setLocation((previous) => ({
        // The first report of a section can come before its pages are counted.
        fraction: Number.isFinite(detail.fraction) ? detail.fraction : (previous?.fraction ?? 0),
        section,
        sectionCount,
        tocHref: detail.tocItem?.href ?? "",
        tocLabel: (detail.tocItem?.label ?? "").trim(),
      }));
      if (sectionCount > 0) {
        pageChangeCallbackRef.current(section, sectionCount);
        saveEpubPosition(bookId, { section, cfi: detail.cfi });
      }
    };

    const open = async () => {
      const foliate = await createFoliateView();
      if (!active) {
        return;
      }
      opened = foliate;
      foliate.className = "epub-view";
      foliate.addEventListener("relocate", (event) => handleRelocate(event.detail));
      foliate.addEventListener("load", ({ detail: { doc } }) => {
        doc.addEventListener("keydown", (event) => handlersRef.current?.handleKeyDown(event));
        doc.addEventListener("wheel", (event) => handlersRef.current?.handleWheel(event), {
          passive: true,
        });
        doc.addEventListener("click", (event) => handlersRef.current?.handleClick(event));
      });
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
        renderer.setAttribute("max-column-count", "2");
      }
      setToc(flattenToc(foliate.book?.toc));
      setView(foliate);

      const saved = loadEpubPosition(bookId);
      if (saved?.section === initialSection) {
        await foliate.init({ lastLocation: saved.cfi });
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
  }, [book.id, book.url, initialSection]);

  useEffect(() => {
    view?.renderer?.setStyles(epubStyles(fontScale, theme));
  }, [view, fontScale, theme]);

  const toggleChrome = useCallback(() => {
    if (openPanel || isViewMenuOpen) {
      setOpenPanel(null);
      setIsViewMenuOpen(false);
      return;
    }
    setChromeVisible((current) => !current);
  }, [isViewMenuOpen, openPanel]);

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
        setOpenPanel((panel) => (panel === "search" ? null : "search"));
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
        toggleChrome();
      }
    },
    [toggleChrome, turnPage],
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
      toggleChrome();
    },
    [toggleChrome],
  );

  useLayoutEffect(() => {
    handlersRef.current = { handleKeyDown, handleWheel, handleClick };
  }, [handleKeyDown, handleWheel, handleClick]);

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

  function changeFontScale(next: number) {
    const clamped = Math.min(EPUB_MAX_FONT_SCALE, Math.max(EPUB_MIN_FONT_SCALE, next));
    setFontScale(clamped);
    saveEpubFontScale(clamped);
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
  const panelTitle = openPanel === "toc" ? t("reader.toc") : t("reader.textSearch");
  const isRtl = view?.book?.dir === "rtl";
  const sectionLabel = location?.tocLabel ?? "";

  return (
    <section
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

      <header
        className="reader-topbar glass"
        onMouseEnter={() => setIsTopbarHovered(true)}
        onMouseLeave={() => setIsTopbarHovered(false)}
        onFocus={() => setIsTopbarFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setIsTopbarFocused(false);
          }
        }}
      >
        <div className="reader-topbar-start">
          {onBack && (
            <button type="button" className="glass-button reader-back" onClick={onBack}>
              <CaretLeftIcon size={15} weight="bold" aria-hidden="true" />
              {t("reader.backToLibrary")}
            </button>
          )}
          <span className="reader-topbar-separator" aria-hidden="true" />
          <ToolButton
            label={openPanel === "toc" ? t("reader.closeToc") : t("reader.openToc")}
            className={openPanel === "toc" ? "is-active" : ""}
            onClick={() => setOpenPanel((panel) => (panel === "toc" ? null : "toc"))}
            disabled={!isReady}
          >
            <ListBulletsIcon size={17} weight="regular" />
          </ToolButton>
          <ToolButton
            label={openPanel === "search" ? t("reader.closeSearch") : t("reader.openSearch")}
            className={openPanel === "search" ? "is-active" : ""}
            onClick={() => setOpenPanel((panel) => (panel === "search" ? null : "search"))}
            disabled={!isReady}
          >
            <MagnifyingGlassIcon size={17} weight="regular" />
          </ToolButton>
        </div>
        <div className="reader-title">
          <strong title={book.title}>{book.title}</strong>
          {sectionLabel && <span>{sectionLabel}</span>}
        </div>
        <div className="reader-topbar-end">
          <ToolButton
            label={t("reader.view")}
            className={isViewMenuOpen ? "is-active" : ""}
            expanded={isViewMenuOpen}
            onClick={() => setIsViewMenuOpen((current) => !current)}
          >
            <TextAaIcon size={17} weight="regular" />
          </ToolButton>
        </div>
      </header>

      {isViewMenuOpen && (
        <div
          className="reader-view-menu glass glass-strong"
          role="dialog"
          aria-label={t("reader.view")}
        >
          <section>
            <h2>{t("reader.textSize")}</h2>
            <div className="reader-zoom-row">
              <div className="reader-zoom-stepper">
                <button
                  type="button"
                  className="glass-button"
                  aria-label={t("reader.smallerText")}
                  disabled={fontScale <= EPUB_MIN_FONT_SCALE}
                  onClick={() => changeFontScale(fontScale - EPUB_FONT_SCALE_STEP)}
                >
                  <MinusIcon size={13} weight="bold" aria-hidden="true" />
                </button>
                <span>{fontScale}%</span>
                <button
                  type="button"
                  className="glass-button"
                  aria-label={t("reader.largerText")}
                  disabled={fontScale >= EPUB_MAX_FONT_SCALE}
                  onClick={() => changeFontScale(fontScale + EPUB_FONT_SCALE_STEP)}
                >
                  <PlusIcon size={13} weight="bold" aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                className="reader-fit-button"
                aria-pressed={fontScale === 100}
                onClick={() => changeFontScale(100)}
              >
                {t("reader.defaultTextSize")}
              </button>
            </div>
          </section>
        </div>
      )}

      {openPanel && (
        <aside
          className={`reader-sheet glass glass-strong reader-sheet-${openPanel}`}
          aria-label={panelTitle}
        >
          <div className="reader-sheet-header">
            <h2>{panelTitle}</h2>
            <button
              type="button"
              className="glass-button reader-sheet-close"
              aria-label={t("reader.closePanel")}
              onClick={() => setOpenPanel(null)}
            >
              <XIcon size={14} weight="bold" aria-hidden="true" />
            </button>
          </div>
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
          {openPanel === "search" && (
            <>
              <form
                className="reader-search-form"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitBookSearch();
                }}
              >
                <label className="reader-search-field">
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
                </label>
                <button
                  type="submit"
                  className="solid-button"
                  disabled={!searchQuery.trim() || isSearching}
                >
                  {isSearching ? t("reader.searchingAction") : t("reader.searchAction")}
                </button>
              </form>
              <div className="reader-sheet-scroll">
                {searchError ? (
                  <p className="reader-sheet-message is-error" role="alert">
                    {searchError}
                  </p>
                ) : submittedSearchQuery ? (
                  isSearching ? (
                    <p className="reader-sheet-message">
                      {t("reader.searchingFor", { query: submittedSearchQuery })}
                    </p>
                  ) : searchResults.length === 0 ? (
                    <p className="reader-sheet-message">
                      {t("reader.noResults", { query: submittedSearchQuery })}
                    </p>
                  ) : (
                    <>
                      <p className="reader-search-count">
                        {t("reader.resultsFound", { count: searchResults.length })}
                      </p>
                      <ol className="reader-search-results">
                        {searchResults.map((result) => {
                          const title =
                            result.headingPath ||
                            t("reader.sectionNumber", { number: result.pageNumber });
                          return (
                            <li key={result.pageNumber}>
                              <button
                                type="button"
                                className={
                                  result.pageNumber === location?.section ? "is-active" : ""
                                }
                                aria-label={t("reader.goToSection", { title })}
                                onClick={() => void openSearchResult(result.pageNumber)}
                              >
                                <span className="reader-search-result-meta">
                                  <strong>{title}</strong>
                                  <span>{t("reader.matches", { count: result.matchCount })}</span>
                                </span>
                                <span className="reader-search-excerpt">
                                  <HighlightedExcerpt
                                    text={result.excerpt}
                                    query={submittedSearchQuery}
                                  />
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )
                ) : (
                  <p className="reader-sheet-message">{t("reader.searchPrompt")}</p>
                )}
              </div>
            </>
          )}
        </aside>
      )}

      <footer className="reader-bottombar glass" aria-label={t("reader.pageControls")}>
        <ToolButton
          label={isRtl ? t("reader.nextPage") : t("reader.previousPage")}
          disabled={!isReady}
          onClick={() => turnPage("left")}
        >
          <CaretLeftIcon size={16} weight="bold" />
        </ToolButton>
        <span className="page-count epub-page-count">{percent}%</span>
        <ToolButton
          label={isRtl ? t("reader.previousPage") : t("reader.nextPage")}
          disabled={!isReady}
          onClick={() => turnPage("right")}
        >
          <CaretRightIcon size={16} weight="bold" />
        </ToolButton>
        <div className="reader-page-slider">
          <div className={`reader-page-rail${isRtl ? " is-rtl" : ""}`}>
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
              onChange={(event) =>
                void view?.goToFraction(Number(event.target.value) / sliderSteps)
              }
            />
          </div>
        </div>
      </footer>
    </section>
  );
}
