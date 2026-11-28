import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenIcon, BookOpenTextIcon, CornersInIcon, FileIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { saveBindingDirection, type BookHighlight, type HighlightColor } from "../api";
import type { BindingDirection, BookFile } from "../../../shared/api/books";
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
import { rectContainsPoint, selectionToPageSelections, type PageSelection } from "./highlights";
import { OutlineList } from "./OutlineList";
import { usePageInput } from "./usePageInput";
import { usePdfBookmarks, usePdfHighlights } from "./usePdfAnnotations";
import { usePdfDocument } from "./usePdfDocument";
import { usePdfOutline } from "./usePdfOutline";
import { usePdfPageRender, type ViewMode } from "./usePdfPageRender";
import { usePdfReadAloud } from "./usePdfReadAloud";
import { usePdfStage } from "./usePdfStage";
import "../reader.css";

const manualZoomStep = 0.1;

function sameLayout<T extends Record<string, unknown>>(a: T, b: T): boolean {
  return Object.keys(a).every((key) => Object.is(a[key], b[key]));
}

type PendingSelection = FloatingAnchor & { parts: PageSelection[] };
type ActiveHighlight = FloatingAnchor & { id: number };

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
  const { t } = useTranslation();
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const textLayerLeftRef = useRef<HTMLDivElement>(null);
  const textLayerRightRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageChangeCallbackRef = useRef(onPageChange);
  useEffect(() => {
    pageChangeCallbackRef.current = onPageChange;
  }, [onPageChange]);

  const [pageNumber, setPageNumber] = useState(() => Math.max(1, initialPage));
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [bindingDirection, setBindingDirection] = useState<BindingDirection>(() =>
    bindingDirectionOf(book),
  );
  const { openPanel, setOpenPanel, togglePanel } = useReaderPanel();
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const chrome = useReaderChrome({
    panelOpen: openPanel !== null || isViewMenuOpen,
    forceWindowControls: !book,
  });
  const search = useBookSearch(book?.id);
  const readAloud = useReadAloud();
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<ActiveHighlight | null>(null);

  const { document, error, setError } = usePdfDocument(book, initialPage, {
    onLoaded: (_loaded, startPage) => setPageNumber(startPage),
  });

  const {
    stageRef,
    stageNodeRef,
    stageSize,
    zoomMode,
    setZoomMode,
    effectiveScale,
    setEffectiveScale,
    adjustZoom,
  } = usePdfStage({
    scrollResetKey: document ? pageNumber : null,
    onClick: (event) => handleStageClick(event),
    onMouseUp: () => handleStageMouseUp(),
    onScroll: () => {
      setPendingSelection(null);
      setActiveHighlight(null);
    },
  });

  const render = usePdfPageRender({
    document,
    pageNumber,
    viewMode,
    zoomMode,
    stageSize,
    canvases: [canvasLeftRef, canvasRightRef],
    textLayers: [textLayerLeftRef, textLayerRightRef],
    onDrawn: setEffectiveScale,
    onTextReady: (pageCount) => pageChangeCallbackRef.current(pageNumber, pageCount),
    onError: setError,
  });
  const { renderedPages } = render;
  const outline = usePdfOutline(document, pageNumber);
  const bookmarks = usePdfBookmarks(book, document, pageNumber);
  const highlights = usePdfHighlights(book, document);
  usePdfReadAloud({
    readAloud,
    document,
    pageNumber,
    readableText: render.readableText,
    setPageNumber,
  });

  const numPages = document?.numPages ?? 0;
  const {
    value: pageInputValue,
    setValue: setPageInputValue,
    editing: isEditingPage,
    inputRef: pageInputRef,
    start: startEditingPage,
    finish: finishEditingPage,
    cancel: cancelEditingPage,
  } = usePageInput(pageNumber, numPages, setPageNumber);

  const layout = { bookId: book?.id, pageNumber, viewMode, zoomMode, stageSize };
  const [placedLayout, setPlacedLayout] = useState(layout);
  if (!sameLayout(placedLayout, layout)) {
    setPlacedLayout(layout);
    setPendingSelection(null);
    setActiveHighlight(null);
  }

  useEffect(() => {
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

  const { setChromeVisible } = chrome;
  useEffect(() => {
    if (!document) {
      return;
    }
    const pageCount = document.numPages;
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
        setPageNumber((current) => Math.min(pageCount, current + step));
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
    setChromeVisible,
  ]);

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
      return highlights.highlights.findLast(
        (highlight) =>
          highlight.location.page === hitPage &&
          highlight.location.rects.some((rect) => rectContainsPoint(rect, x, y)),
      );
    }
    return undefined;
  }

  function handleStageClick(event: MouseEvent) {
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
        width: reader.width,
      });
      return;
    }
    if (openPanel || isViewMenuOpen) {
      setOpenPanel(null);
      setIsViewMenuOpen(false);
      return;
    }
    setChromeVisible((current) => !current);
  }

  function handleStageMouseUp() {
    const selection = window.getSelection();
    const stageNode = stageNodeRef.current;
    const reader = readerRef.current?.getBoundingClientRect();
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !stageNode ||
      !reader
    ) {
      return;
    }
    const range = selection.getRangeAt(0);
    const pages = Array.from(stageNode.querySelectorAll<HTMLElement>(".pdf-page[data-page]"));
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
      width: reader.width,
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

  const jumpToOutlinePage = useCallback(
    (target: number) => {
      if (!document) {
        return;
      }
      const clamped = Math.min(document.numPages, Math.max(1, target));
      setPageNumber(clamped);
    },
    [document, setPageNumber],
  );

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
  const { pageBookmarks } = bookmarks;
  const { pageHighlights } = highlights;
  const highlightedText = activeHighlight
    ? highlights.highlights.find((highlight) => highlight.id === activeHighlight.id)
    : undefined;

  async function saveSelectionHighlight(color: HighlightColor) {
    if (!pendingSelection) {
      return;
    }
    if (await highlights.saveSelection(pendingSelection.parts, color)) {
      window.getSelection()?.removeAllRanges();
      setPendingSelection(null);
    }
  }

  async function deleteHighlight(id: number) {
    if (await highlights.remove(id)) {
      setActiveHighlight((current) => (current?.id === id ? null : current));
    }
  }

  function renderHighlightLayer(layerPageNumber: number | undefined) {
    if (layerPageNumber === undefined) {
      return null;
    }
    return (
      <div className="highlight-layer" aria-hidden="true">
        {highlights.highlights
          .filter((highlight) => highlight.location.page === layerPageNumber)
          .flatMap((highlight) =>
            highlight.location.rects.map((rect) => (
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

  return (
    <section
      ref={readerRef}
      className={`reader ambient${chrome.chromeShown ? " is-chrome-visible" : ""}`}
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
          supported: readAloud.supported,
          active: readAloud.active,
          onToggle: readAloud.toggle,
        }}
        bookmark={{
          label: bookmarks.currentPageBookmarked
            ? t("reader.removePageBookmark", { page: pageNumber })
            : t("reader.savePageBookmark", { page: pageNumber }),
          active: bookmarks.currentPageBookmarked,
          disabled: bookmarks.busy,
          onToggle: () => void bookmarks.toggleCurrentPage(),
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
        onHoverChange={chrome.setTopbarHovered}
        onFocusChange={chrome.setTopbarFocused}
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
            decrease={{
              label: t("reader.zoomOut"),
              onClick: () => adjustZoom(-manualZoomStep),
            }}
            increase={{
              label: t("reader.zoomIn"),
              onClick: () => adjustZoom(manualZoomStep),
            }}
            reset={{
              label: t("reader.fitPage"),
              icon: <CornersInIcon size={14} aria-hidden="true" />,
              pressed: zoomMode.kind === "fit-page",
              onClick: () => setZoomMode({ kind: "fit-page" }),
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

      {activeHighlight && highlightedText && (
        <HighlightActionsToolbar
          style={floatingStyle(activeHighlight)}
          color={highlightedText.color}
          busy={highlights.busy}
          onRecolor={(color) => void highlights.recolor(highlightedText.id, color)}
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
              {outline.outline.length === 0 ? (
                <p className="reader-sheet-message">
                  {outline.loaded ? t("reader.noToc") : t("reader.loadingToc")}
                </p>
              ) : (
                <OutlineList
                  nodes={outline.outline}
                  parentPath=""
                  depth={0}
                  activeKey={outline.activeKey}
                  onSelect={jumpToOutlinePage}
                />
              )}
            </div>
          )}
          {openPanel === "search" && (
            <BookSearchPanel
              inputRef={searchInputRef}
              query={search.query}
              onQueryChange={search.setQuery}
              onSubmit={() => void search.submit()}
              submittedQuery={search.submittedQuery}
              searching={search.searching}
              error={search.error}
              results={search.results}
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
              loaded={highlights.loaded}
              error={highlights.error}
              busy={highlights.busy}
              entries={pageHighlights.map((highlight) => ({
                key: highlight.id,
                color: highlight.color,
                active: renderedPages.includes(highlight.location.page),
                place: t("reader.bookmarkPage", { page: highlight.location.page }),
                text: highlight.text,
                goLabel: t("reader.goToHighlight", { page: highlight.location.page }),
                removeLabel: t("reader.removeHighlightOnPage", { page: highlight.location.page }),
                onGo: () => jumpToOutlinePage(highlight.location.page),
                onRemove: () => void deleteHighlight(highlight.id),
              }))}
            />
          )}
          {openPanel === "bookmarks" && (
            <BookmarkList
              loaded={bookmarks.loaded}
              error={bookmarks.error}
              busy={bookmarks.busy}
              emptyMessage={t("reader.noBookmarks")}
              entries={pageBookmarks.map((bookmark) => ({
                key: bookmark.location.page,
                active: bookmark.location.page === pageNumber,
                title: t("reader.bookmarkPage", { page: bookmark.location.page }),
                detail: t("reader.bookmarkSaved"),
                goLabel: t("reader.goToBookmark", { page: bookmark.location.page }),
                removeLabel: t("reader.removePageBookmark", { page: bookmark.location.page }),
                onGo: () => jumpToOutlinePage(bookmark.location.page),
                onRemove: () => void bookmarks.remove(bookmark.location.page),
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
                finishEditingPage();
              }}
            >
              <input
                ref={pageInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label={t("reader.pageNumber")}
                value={pageInputValue}
                size={pageInputWidth}
                onChange={(event) =>
                  setPageInputValue(event.target.value.replaceAll(/[^0-9]/g, ""))
                }
                onBlur={() => finishEditingPage()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEditingPage();
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
                key: bookmark.location.page,
                position: numPages > 1 ? ((bookmark.location.page - 1) / (numPages - 1)) * 100 : 0,
                current: bookmark.location.page === pageNumber,
                label: t("reader.sliderBookmark", { page: bookmark.location.page }),
                tooltip: t("reader.bookmarkPage", { page: bookmark.location.page }),
                onGo: () => jumpToOutlinePage(bookmark.location.page),
              }))
            : []
        }
      />
    </section>
  );
}
