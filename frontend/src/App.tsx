import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { BookOpenText, Books, GearSix, MagnifyingGlass, SidebarSimple } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ChatSidebar } from "./features/chat/ChatSidebar";
import { generateCoverThumbnail } from "./features/library/generateCover";
import { indexBookPages, isAbortError, type IndexableBook } from "./features/library/indexer";
import { Library } from "./features/library/Library";
import { LibrarySearch, type LibrarySearchStatus } from "./features/library/LibrarySearch";
import { EpubReaderPlaceholder } from "./features/reader/EpubReaderPlaceholder";
import { PdfReader, type ReaderSelection } from "./features/reader/PdfReader";
import { LLMSettingsPage } from "./features/settings/LLMSettingsPage";
import { syncDocumentTheme } from "./features/settings/theme";
import { I18nProvider } from "./shared/i18n/i18n";
import {
  getAppearanceSettings,
  listBooks,
  markBookCoverFailed,
  openBook,
  openBookFile,
  relinkBook,
  removeBook,
  renameBook,
  saveBookCover,
  saveAppearanceSettings,
  saveReadingPosition,
  searchLibrary,
  type BookFile,
  type BookSummary,
  type LibrarySearchHit,
  type ThemePreference,
} from "./shared/api/backend";

type PageContext = {
  pageNumber: number;
  text: string;
};

function AppContent() {
  const { t } = useTranslation();
  const [view, setView] = useState<"library" | "search" | "reader" | "settings">("library");
  const [settingsReturnView, setSettingsReturnView] = useState<"library" | "search" | "reader">("library");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [busyBookId, setBusyBookId] = useState("");
  const [book, setBook] = useState<BookFile | null>(null);
  const [pageContext, setPageContext] = useState<PageContext>({ pageNumber: 0, text: "" });
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [opening, setOpening] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [themeLoading, setThemeLoading] = useState(true);
  const [themeError, setThemeError] = useState("");
  const [assistantWidth, setAssistantWidth] = useState(390);
  const [assistantVisible, setAssistantVisible] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LibrarySearchHit[]>([]);
  const [searchStatus, setSearchStatus] = useState<LibrarySearchStatus>("idle");
  const [searchError, setSearchError] = useState("");
  const indexAbortersRef = useRef<Map<string, AbortController>>(new Map());
  const searchRequestRef = useRef(0);
  const resizeState = useRef<{ startX: number; startWidth: number } | null>(null);
  const generatingCovers = useRef(new Set<string>());
  const lastSavedPosition = useRef("");

  const refreshLibrary = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setLibraryLoading(true);
    }
    try {
      setBooks(await listBooks());
      setLibraryError("");
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : t("error.loadLibrary"));
    } finally {
      setLibraryLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refreshLibrary(true);
  }, [refreshLibrary]);

  useLayoutEffect(() => syncDocumentTheme(theme), [theme]);

  useEffect(() => {
    let active = true;
    void getAppearanceSettings()
      .then((loaded) => {
        if (!active) return;
        setTheme(loaded.theme);
        setThemeError("");
      })
      .catch((reason) => {
        if (!active) return;
        setThemeError(reason instanceof Error ? reason.message : t("error.loadAppearance"));
      })
      .finally(() => {
        if (active) setThemeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  const handleThemeChange = useCallback(async (next: ThemePreference) => {
    const previous = theme;
    setTheme(next);
    setThemeError("");
    try {
      const saved = await saveAppearanceSettings(next);
      setTheme(saved.theme);
    } catch (reason) {
      setTheme(previous);
      const message = reason instanceof Error ? reason.message : t("error.saveAppearance");
      setThemeError(message);
      throw new Error(message);
    }
  }, [t, theme]);

  const ensureCover = useCallback(async (selected: BookFile) => {
    if (selected.coverStatus !== "pending" || generatingCovers.current.has(selected.id)) {
      return;
    }
    generatingCovers.current.add(selected.id);
    try {
      const cover = await generateCoverThumbnail(selected.url);
      await saveBookCover(selected.id, cover);
    } catch {
      try {
        await markBookCoverFailed(selected.id);
      } catch {
        // A missing thumbnail must not prevent reading.
      }
    } finally {
      generatingCovers.current.delete(selected.id);
      await refreshLibrary();
    }
  }, [refreshLibrary]);

  const ensureBookIndexed = useCallback((target: IndexableBook) => {
    if (!target.url || !target.id) {
      return;
    }
    if (target.format === "epub") {
      return;
    }
    if (indexAbortersRef.current.has(target.id)) {
      return;
    }
    const controller = new AbortController();
    indexAbortersRef.current.set(target.id, controller);
    void indexBookPages(
      { id: target.id, url: target.url, indexedPageCount: target.indexedPageCount ?? 0 },
      { signal: controller.signal },
    )
      .then((result) => {
        setBook((book) =>
          book && book.id === target.id
            ? { ...book, indexedPageCount: result.persistedCount }
            : book,
        );
        void refreshLibrary();
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason)) {
          return;
        }
        console.warn("Book indexing failed", reason);
      })
      .finally(() => {
        indexAbortersRef.current.delete(target.id);
      });
  }, [refreshLibrary]);

  useEffect(() => {
    const aborters = indexAbortersRef.current;
    return () => {
      aborters.forEach((controller) => controller.abort());
      aborters.clear();
    };
  }, []);

  const showReader = useCallback((selected: BookFile) => {
    lastSavedPosition.current = "";
    setPageContext({ pageNumber: 0, text: "" });
    setSelection(null);
    setBook(selected);
    setView("reader");
    if (selected.format !== "epub") {
      void ensureCover(selected);
    }
    ensureBookIndexed(selected);
  }, [ensureCover, ensureBookIndexed]);

  const handleSelectionChange = useCallback((next: ReaderSelection | null) => {
    setSelection(next);
  }, []);

  async function handleImportPDF() {
    setOpening(true);
    setLibraryError("");
    try {
      const selected = await openBookFile();
      if (selected.url) {
        showReader(selected);
        await refreshLibrary();
      }
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : t("error.addPdf"));
    } finally {
      setOpening(false);
    }
  }

  async function handleOpenBook(summary: BookSummary) {
    if (!summary.available) {
      return;
    }
    setBusyBookId(summary.id);
    setLibraryError("");
    try {
      showReader(await openBook(summary.id));
      await refreshLibrary();
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : t("error.openBook"));
      await refreshLibrary();
    } finally {
      setBusyBookId("");
    }
  }

  async function handleOpenBookAtPage(summary: BookSummary, pageNumber: number) {
    if (!summary.available) {
      return;
    }
    setBusyBookId(summary.id);
    setLibraryError("");
    try {
      const opened = await openBook(summary.id);
      showReader({ ...opened, initialPage: pageNumber });
      await refreshLibrary();
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : t("error.openBook"));
      await refreshLibrary();
    } finally {
      setBusyBookId("");
    }
  }

  const handleLibrarySearchSubmit = useCallback(async () => {
    const query = searchInput.trim();
    if (!query) {
      return;
    }
    const request = searchRequestRef.current + 1;
    searchRequestRef.current = request;
    setSearchQuery(query);
    setSearchStatus("loading");
    setSearchError("");
    try {
      const hits = await searchLibrary(query);
      if (searchRequestRef.current !== request) {
        return;
      }
      setSearchResults(hits);
      setSearchStatus("ready");
    } catch (reason) {
      if (searchRequestRef.current !== request) {
        return;
      }
      setSearchResults([]);
      setSearchStatus("error");
      setSearchError(reason instanceof Error ? reason.message : t("error.searchLibrary"));
    }
  }, [searchInput, t]);

  const handleLibrarySearchClear = useCallback(() => {
    searchRequestRef.current += 1;
    setSearchInput("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchStatus("idle");
    setSearchError("");
  }, []);

  async function handleRemoveBook(summary: BookSummary) {
    setBusyBookId(summary.id);
    setLibraryError("");
    try {
      const removed = await removeBook(summary.id);
      if (removed) {
        await refreshLibrary();
      }
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : t("error.removeBook"));
    } finally {
      setBusyBookId("");
    }
  }

  async function handleRenameBook(summary: BookSummary, name: string) {
    setBusyBookId(summary.id);
    setLibraryError("");
    try {
      const renamed = await renameBook(summary.id, name);
      setBooks((current) =>
        current.map((entry) => (entry.id === renamed.id ? renamed : entry)),
      );
      setBook((current) =>
        current && current.id === renamed.id
          ? { ...current, title: renamed.title }
          : current,
      );
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : t("error.renameBook"));
    } finally {
      setBusyBookId("");
    }
  }

  async function handleRelinkBook(summary: BookSummary) {
    setBusyBookId(summary.id);
    setLibraryError("");
    try {
      const selected = await relinkBook(summary.id);
      if (selected.url) {
        showReader(selected);
        await refreshLibrary();
      }
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : t("error.relinkPdf"));
    } finally {
      setBusyBookId("");
    }
  }

  const handlePageContextChange = useCallback((pageNumber: number, text: string, pageCount: number) => {
    setPageContext({ pageNumber, text });
    if (!book || pageNumber < 1 || pageCount < 1) {
      return;
    }
    const positionKey = `${book.id}:${pageNumber}:${pageCount}`;
    if (lastSavedPosition.current === positionKey) {
      return;
    }
    lastSavedPosition.current = positionKey;
    void saveReadingPosition(book.id, pageNumber, pageCount).catch((reason) => {
      console.warn(reason instanceof Error ? reason.message : t("error.savePosition"));
    });
  }, [book, t]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!resizeState.current) {
        return;
      }
      const nextWidth = resizeState.current.startWidth + resizeState.current.startX - event.clientX;
      setAssistantWidth(Math.min(520, Math.max(328, nextWidth)));
    }
    function handlePointerUp() {
      if (!resizeState.current) {
        return;
      }
      resizeState.current = null;
      document.body.classList.remove("is-resizing");
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const workspaceStyle = { "--assistant-width": `${assistantWidth}px` } as CSSProperties;

  const toggleAssistant = useCallback(() => {
    setAssistantVisible((visible) => !visible);
  }, []);

  const openSettings = useCallback(() => {
    if (view === "settings") {
      return;
    }
    const returnView: "library" | "search" | "reader" =
      view === "reader" && book ? "reader" : view === "search" ? "search" : "library";
    if (returnView === "reader" && pageContext.pageNumber > 0) {
      setBook((current) => current ? { ...current, initialPage: pageContext.pageNumber } : current);
    }
    setSettingsReturnView(returnView);
    setView("settings");
  }, [book, pageContext.pageNumber, view]);

  const closeSettings = useCallback(() => {
    if (settingsReturnView === "reader" && book) {
      setView("reader");
    } else {
      setView(settingsReturnView === "search" ? "search" : "library");
    }
  }, [book, settingsReturnView]);

  const showLibrary = useCallback(() => {
    setView("library");
    void refreshLibrary();
  }, [refreshLibrary]);

  const showSearch = useCallback(() => {
    setView("search");
  }, []);

  const resumeReader = useCallback(() => {
    if (!book) {
      return;
    }
    if (pageContext.pageNumber > 0) {
      setBook((current) => current ? { ...current, initialPage: pageContext.pageNumber } : current);
    }
    setView("reader");
  }, [book, pageContext.pageNumber]);

  const contextLabel =
    view === "reader" && book
      ? book.title
      : view === "settings"
        ? t("app.settings")
        : view === "search"
          ? t("app.search")
          : t("app.library");
  const ContextIcon =
    view === "reader" && book
      ? BookOpenText
      : view === "settings"
        ? GearSix
        : view === "search"
          ? MagnifyingGlass
          : Books;

  return (
    <Tooltip.Provider delay={500} closeDelay={80}>
      <main className="app-shell">
        <header className="app-toolbar" aria-label="Glint">
          <div className="app-chrome">
            <span className="wordmark">GLINT</span>
            <span className="chrome-separator" aria-hidden="true" />
            <span className="chrome-view" title={contextLabel}>
              <ContextIcon size={13} weight="regular" />
              <span>{contextLabel}</span>
            </span>
          </div>
          {view === "reader" && book && (
            <div className="app-toolbar-trailing">
              <button
                type="button"
                className={assistantVisible ? "app-toolbar-toggle is-active" : "app-toolbar-toggle"}
                aria-pressed={assistantVisible}
                aria-label={assistantVisible ? t("app.hideAssistant") : t("app.showAssistant")}
                title={assistantVisible ? t("app.hideAssistant") : t("app.showAssistant")}
                onClick={toggleAssistant}
              >
                <SidebarSimple size={16} weight={assistantVisible ? "fill" : "regular"} />
              </button>
            </div>
          )}
        </header>

        <div className="app-body">
          <aside className="app-navigation" aria-label={t("app.mainNavigation")}>
            <nav className="app-navigation-primary">
              <button
                type="button"
                className={view === "library" ? "app-nav-button is-active" : "app-nav-button"}
                aria-current={view === "library" ? "page" : undefined}
                onClick={showLibrary}
              >
                <Books size={20} weight={view === "library" ? "fill" : "regular"} />
                <span>{t("app.library")}</span>
              </button>
              <button
                type="button"
                className={view === "search" ? "app-nav-button is-active" : "app-nav-button"}
                aria-current={view === "search" ? "page" : undefined}
                onClick={showSearch}
              >
                <MagnifyingGlass size={20} weight={view === "search" ? "fill" : "regular"} />
                <span>{t("app.search")}</span>
              </button>
              <button
                type="button"
                className={view === "reader" ? "app-nav-button is-active" : "app-nav-button"}
                aria-current={view === "reader" ? "page" : undefined}
                onClick={resumeReader}
                disabled={!book}
              >
                <BookOpenText size={20} weight={view === "reader" ? "fill" : "regular"} />
                <span>{t("app.read")}</span>
              </button>
            </nav>

            <div className="app-navigation-secondary">
              {book && pageContext.pageNumber > 0 && (
                <div className="nav-reading-position" aria-label={t("app.pageLabel", { page: pageContext.pageNumber })}>
                  <span>{t("app.page").toUpperCase()}</span>
                  <i aria-hidden="true" />
                  <strong>{String(pageContext.pageNumber).padStart(3, "0")}</strong>
                </div>
              )}
              <button
                type="button"
                className={view === "settings" ? "app-nav-button is-active" : "app-nav-button"}
                aria-current={view === "settings" ? "page" : undefined}
                onClick={openSettings}
              >
                <GearSix size={20} weight={view === "settings" ? "fill" : "regular"} />
                <span>{t("app.settings")}</span>
              </button>
            </div>
          </aside>

          <div className="app-content">
            {view === "settings" ? (
              <LLMSettingsPage
                onBack={closeSettings}
                theme={theme}
                themeLoading={themeLoading}
                themeError={themeError}
                onThemeChange={handleThemeChange}
              />
            ) : view === "library" ? (
              <Library
                books={books}
                loading={libraryLoading}
                error={libraryError}
                busyBookId={busyBookId}
                opening={opening}
                onImport={handleImportPDF}
                onOpen={handleOpenBook}
                onRelink={handleRelinkBook}
                onRemove={handleRemoveBook}
                onRename={handleRenameBook}
              />
            ) : view === "search" ? (
              <LibrarySearch
                busyBookId={busyBookId}
                searchQuery={searchQuery}
                searchInput={searchInput}
                searchResults={searchResults}
                searchStatus={searchStatus}
                searchError={searchError}
                onSearchInputChange={setSearchInput}
                onSearchSubmit={handleLibrarySearchSubmit}
                onSearchClear={handleLibrarySearchClear}
                onOpenAtPage={handleOpenBookAtPage}
              />
            ) : (
              <div
                className={assistantVisible ? "workspace" : "workspace is-assistant-hidden"}
                style={workspaceStyle}
              >
                {book?.format === "epub" ? (
                  <EpubReaderPlaceholder book={book} />
                ) : (
                  <PdfReader
                    book={book}
                    initialPage={book?.initialPage ?? 1}
                    selection={selection}
                    onPageContextChange={handlePageContextChange}
                    onSelectionChange={handleSelectionChange}
                  />
                )}

                {assistantVisible && (
                  <>
                    <div
                      className="panel-resizer"
                      role="separator"
                      aria-label={t("app.resizeAssistant")}
                      aria-orientation="vertical"
                      aria-valuemin={328}
                      aria-valuemax={520}
                      aria-valuenow={Math.round(assistantWidth)}
                      tabIndex={0}
                      onPointerDown={(event) => {
                        resizeState.current = { startX: event.clientX, startWidth: assistantWidth };
                        document.body.classList.add("is-resizing");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft") setAssistantWidth((width) => Math.min(520, width + 12));
                        if (event.key === "ArrowRight") setAssistantWidth((width) => Math.max(328, width - 12));
                      }}
                    >
                      <span />
                    </div>

                    <ChatSidebar
                      context={{
                        bookName: book?.title ?? "",
                        pageNumber: pageContext.pageNumber,
                      }}
                      selection={selection}
                      onClearSelection={() => setSelection(null)}
                      onOpenSettings={openSettings}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </Tooltip.Provider>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}
