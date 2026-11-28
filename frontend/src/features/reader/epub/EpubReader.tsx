import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextAaIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { FoliateShowAnnotationDetail } from "foliate-js/view.js";
import type { BookBookmark, BookHighlight, HighlightColor } from "../api";
import type { BookFile } from "../../../shared/api/books";
import { BookmarkList, HighlightList } from "../common/AnnotationLists";
import { BookSearchPanel } from "../common/BookSearchPanel";
import {
  floatingStyle,
  HighlightActionsToolbar,
  SelectionHighlightToolbar,
  type FloatingAnchor,
} from "../common/HighlightToolbars";
import { ReaderBottomBar } from "../common/ReaderBottomBar";
import { ReaderSheet } from "../common/ReaderSheet";
import { ReaderTopBar, useReaderPanel } from "../common/ReaderTopBar";
import { LayoutSection, ReaderViewMenu, ScaleSection } from "../common/ReaderViewMenu";
import { useReadAloud } from "../common/speech";
import { useBookSearch } from "../common/useBookSearch";
import { useReaderChrome } from "../common/useReaderChrome";
import { EPUB_FONT_SCALE_STEP, EPUB_MAX_FONT_SCALE, EPUB_MIN_FONT_SCALE } from "./epubContent";
import { isEditableTarget, isElementLike, rangeAnchor } from "./epubDom";
import { useEpubBookmarks, useEpubHighlights } from "./useEpubAnnotations";
import { useEpubReadAloud } from "./useEpubReadAloud";
import { useEpubSettings } from "./useEpubSettings";
import { useFoliateView, type FoliateHandlers } from "./useFoliateView";
import { usePlaceLabels } from "./usePlaceLabels";
import "../reader.css";

type PendingSelection = FloatingAnchor & {
  cfi: string;
  text: string;
  section: number;
  doc: Document;
};

type ActiveHighlight = FloatingAnchor & { id: number };

type TurnDirection = "left" | "right" | "next" | "prev";

function progressPercent(bookmark: BookBookmark): number {
  return Math.round(bookmark.progress * 100);
}

const wheelTurnThreshold = 60;
const wheelCooldownMilliseconds = 450;
const sliderSteps = 1000;

const keyDirections: Partial<Record<string, TurnDirection>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  PageDown: "next",
  PageUp: "prev",
};

type EpubReaderProps = {
  book: BookFile;
  initialSection?: number;
  onPageChange: (section: number, sectionCount: number, cfi: string) => void;
  onBack?: () => void;
};

export function EpubReader({ book, initialSection = 1, onPageChange, onBack }: EpubReaderProps) {
  const initialCfi = book.initialCfi ?? "";
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const handlersRef = useRef<FoliateHandlers | null>(null);
  // foliate-js asks for highlights while it draws a section, outside React's
  // render, so it reads them here.
  const highlightsRef = useRef<BookHighlight[]>([]);
  const pageRangeRef = useRef<Range | null>(null);
  const pageChangeCallbackRef = useRef(onPageChange);
  useEffect(() => {
    pageChangeCallbackRef.current = onPageChange;
  }, [onPageChange]);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<ActiveHighlight | null>(null);

  const { view, toc, location, error } = useFoliateView({
    stageRef,
    url: book.url,
    initialCfi,
    initialSection,
    handlersRef,
    highlightsRef,
    onSettingsLoaded: (saved) => settings.apply(saved),
    onRelocate: (next, pageRange) => {
      setPendingSelection(null);
      setActiveHighlight(null);
      pageRangeRef.current = pageRange;
      if (next.sectionCount > 0) {
        pageChangeCallbackRef.current(next.section, next.sectionCount, next.cfi);
      }
    },
  });
  const { openPanel, setOpenPanel, togglePanel } = useReaderPanel();
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const chrome = useReaderChrome({ panelOpen: openPanel !== null || isViewMenuOpen });
  const { setChromeVisible } = chrome;
  const search = useBookSearch(book.id);
  const settings = useEpubSettings(view);
  const highlights = useEpubHighlights(book.id, view, location, highlightsRef);
  const bookmarks = useEpubBookmarks(book.id, location);
  const placeName = usePlaceLabels(view, openPanel, highlights.highlights, bookmarks.bookmarks);
  const readAloud = useReadAloud();

  const readerRef = useRef<HTMLElement>(null);
  const annotationHitRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEpubReadAloud({ readAloud, view, pageCFI: location?.cfi ?? "", pageRangeRef });

  const toggleChrome = useCallback(() => {
    if (openPanel || isViewMenuOpen) {
      setOpenPanel(null);
      setIsViewMenuOpen(false);
      return;
    }
    setChromeVisible((current) => !current);
  }, [isViewMenuOpen, openPanel, setChromeVisible, setIsViewMenuOpen, setOpenPanel]);

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
    [activeHighlight, pendingSelection, setChromeVisible, toggleChrome, togglePanel, turnPage],
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

  const handleAnnotation = useCallback(
    (detail: FoliateShowAnnotationDetail) => {
      const highlight = highlightsRef.current.find((entry) => entry.cfi === detail.value);
      const anchor = rangeAnchor(detail.range, readerRef.current);
      if (!highlight || !anchor) {
        return;
      }
      annotationHitRef.current = true;
      setPendingSelection(null);
      setActiveHighlight({ ...anchor, id: highlight.id });
    },
    [highlightsRef],
  );

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

  async function openSearchResult(section: number) {
    if (!view) {
      return;
    }
    let target: string | number = section - 1;
    view.clearSearch();
    try {
      for await (const found of view.search({ query: search.submittedQuery, index: section - 1 })) {
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
    if (!pendingSelection) {
      return;
    }
    const selection = pendingSelection;
    if (await highlights.save(selection, color)) {
      selection.doc.getSelection()?.removeAllRanges();
      setPendingSelection(null);
    }
  }

  const isReady = view !== null && location !== null;
  const percent = Math.round((location?.fraction ?? 0) * 100);
  const sliderValue = Math.round((location?.fraction ?? 0) * sliderSteps);
  const selectedHighlight = activeHighlight
    ? highlights.highlights.find((entry) => entry.id === activeHighlight.id)
    : undefined;
  const isRtl = view?.book?.dir === "rtl";
  const sectionLabel = location?.tocLabel ?? "";

  return (
    <section
      ref={readerRef}
      className={`reader ambient epub-reader${chrome.chromeShown ? " is-chrome-visible" : ""}`}
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
          supported: readAloud.supported,
          active: readAloud.active,
          onToggle: readAloud.toggle,
        }}
        bookmark={{
          label: bookmarks.pageBookmarked
            ? t("reader.removeBookmarkHere")
            : t("reader.saveBookmarkHere"),
          active: bookmarks.pageBookmarked,
          disabled: bookmarks.busy,
          onToggle: () => void bookmarks.togglePage(),
        }}
        viewMenu={{
          open: isViewMenuOpen,
          icon: <TextAaIcon size={17} weight="regular" />,
          onToggle: () => setIsViewMenuOpen((current) => !current),
        }}
        onHoverChange={chrome.setTopbarHovered}
        onFocusChange={chrome.setTopbarFocused}
        onBack={onBack}
      />

      {isViewMenuOpen && (
        <ReaderViewMenu>
          <LayoutSection
            layout={settings.layout}
            note={t("reader.epubSpreadNote")}
            onChange={settings.changeLayout}
          />
          <ScaleSection
            heading={t("reader.textSize")}
            value={`${settings.fontScale}%`}
            decrease={{
              label: t("reader.smallerText"),
              disabled: settings.fontScale <= EPUB_MIN_FONT_SCALE,
              onClick: () => settings.changeFontScale(settings.fontScale - EPUB_FONT_SCALE_STEP),
            }}
            increase={{
              label: t("reader.largerText"),
              disabled: settings.fontScale >= EPUB_MAX_FONT_SCALE,
              onClick: () => settings.changeFontScale(settings.fontScale + EPUB_FONT_SCALE_STEP),
            }}
            reset={{
              label: t("reader.defaultTextSize"),
              pressed: settings.fontScale === 100,
              onClick: () => settings.changeFontScale(100),
            }}
          />
        </ReaderViewMenu>
      )}

      {(bookmarks.error || highlights.error) && (
        <div className="reader-bookmark-error" role="alert">
          {bookmarks.error || highlights.error}
        </div>
      )}

      {pendingSelection && (
        <SelectionHighlightToolbar
          style={floatingStyle(pendingSelection)}
          busy={highlights.busy}
          onPick={(color) => void saveSelectionHighlight(color)}
        />
      )}

      {activeHighlight && selectedHighlight && (
        <HighlightActionsToolbar
          style={floatingStyle(activeHighlight)}
          color={selectedHighlight.color}
          busy={highlights.busy}
          onRecolor={(color) => void highlights.recolor(selectedHighlight.id, color)}
          onRemove={() =>
            void highlights.remove(selectedHighlight.id, () => setActiveHighlight(null))
          }
        />
      )}

      {openPanel && (
        <ReaderSheet
          panel={openPanel}
          count={
            openPanel === "highlights"
              ? highlights.highlights.length
              : openPanel === "bookmarks"
                ? bookmarks.bookmarks.length
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
              loaded={bookmarks.loaded}
              error={bookmarks.error}
              busy={bookmarks.busy}
              emptyMessage={t("reader.noEpubBookmarks")}
              entries={bookmarks.bookmarks.map((bookmark) => ({
                key: bookmark.cfi,
                active: bookmarks.pageBookmarks.includes(bookmark),
                title: placeName(bookmark),
                detail: `${progressPercent(bookmark)}%`,
                goLabel: t("reader.goToBookmarkIn", { place: placeName(bookmark) }),
                removeLabel: t("reader.removeBookmarkIn", { place: placeName(bookmark) }),
                onGo: () => void view?.goTo(bookmark.cfi),
                onRemove: () => void bookmarks.remove(bookmark),
              }))}
            />
          )}
          {openPanel === "highlights" && (
            <HighlightList
              loaded={highlights.loaded}
              error=""
              busy={highlights.busy}
              entries={highlights.highlights.map((highlight) => ({
                key: highlight.id,
                color: highlight.color,
                active: highlight.pageNumber === location?.section,
                place: placeName(highlight),
                text: highlight.text,
                goLabel: t("reader.goToHighlightIn", { place: placeName(highlight) }),
                removeLabel: t("reader.removeHighlightIn", { place: placeName(highlight) }),
                onGo: () => void view?.goTo(highlight.cfi),
                onRemove: () =>
                  void highlights.remove(highlight.id, () => setActiveHighlight(null)),
              }))}
            />
          )}
          {openPanel === "search" && (
            <BookSearchPanel
              inputRef={searchInputRef}
              query={search.query}
              onQueryChange={search.setQuery}
              onSubmit={() => {
                // foliate-js keeps marks of the last search; a new one starts clean.
                view?.clearSearch();
                void search.submit();
              }}
              submittedQuery={search.submittedQuery}
              searching={search.searching}
              error={search.error}
              results={search.results}
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
            ? bookmarks.bookmarks.map((bookmark) => {
                const place = `${placeName(bookmark)} · ${progressPercent(bookmark)}%`;
                return {
                  key: bookmark.cfi,
                  position: bookmark.progress * 100,
                  current: bookmarks.pageBookmarks.includes(bookmark),
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
