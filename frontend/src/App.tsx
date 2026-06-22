import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { BookOpenText, Books, GearSix } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ChatSidebar } from "./features/chat/ChatSidebar";
import { generateCoverThumbnail } from "./features/library/generateCover";
import { Library } from "./features/library/Library";
import { PdfReader, type ReaderSelection } from "./features/reader/PdfReader";
import { LLMSettingsPage } from "./features/settings/LLMSettingsPage";
import { syncDocumentTheme } from "./features/settings/theme";
import { I18nProvider } from "./shared/i18n/i18n";
import {
  getAppearanceSettings,
  listBooks,
  markBookCoverFailed,
  openBook,
  openPDF,
  relinkPDF,
  removeBook,
  renameBook,
  saveBookCover,
  saveAppearanceSettings,
  saveReadingPosition,
  type BookFile,
  type BookSummary,
  type ThemePreference,
} from "./shared/api/backend";

type PageContext = {
  pageNumber: number;
  text: string;
};

function AppContent() {
  const { t } = useTranslation();
  const [view, setView] = useState<"library" | "reader" | "settings">("library");
  const [settingsReturnView, setSettingsReturnView] = useState<"library" | "reader">("library");
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

  const showReader = useCallback((selected: BookFile) => {
    lastSavedPosition.current = "";
    setPageContext({ pageNumber: 0, text: "" });
    setSelection(null);
    setBook(selected);
    setView("reader");
    void ensureCover(selected);
  }, [ensureCover]);

  const handleSelectionChange = useCallback((next: ReaderSelection | null) => {
    setSelection(next);
  }, []);

  const handleIndexedPageCountChange = useCallback((count: number) => {
    setBook((current) => current ? { ...current, indexedPageCount: count } : current);
  }, []);

  async function handleImportPDF() {
    setOpening(true);
    setLibraryError("");
    try {
      const selected = await openPDF();
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
      const selected = await relinkPDF(summary.id);
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

  const openSettings = useCallback(() => {
    if (view === "settings") {
      return;
    }
    const returnView = view === "reader" && book ? "reader" : "library";
    if (returnView === "reader" && pageContext.pageNumber > 0) {
      setBook((current) => current ? { ...current, initialPage: pageContext.pageNumber } : current);
    }
    setSettingsReturnView(returnView);
    setView("settings");
  }, [book, pageContext.pageNumber, view]);

  const closeSettings = useCallback(() => {
    setView(settingsReturnView === "reader" && book ? "reader" : "library");
  }, [book, settingsReturnView]);

  const showLibrary = useCallback(() => {
    setView("library");
    void refreshLibrary();
  }, [refreshLibrary]);

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
        : t("app.library");
  const ContextIcon = view === "reader" && book ? BookOpenText : view === "settings" ? GearSix : Books;

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
            ) : (
              <div className="workspace" style={workspaceStyle}>
                <PdfReader
                  book={book}
                  initialPage={book?.initialPage ?? 1}
                  onPageContextChange={handlePageContextChange}
                  onSelectionChange={handleSelectionChange}
                  onIndexedPageCountChange={handleIndexedPageCountChange}
                />

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
                    text: pageContext.text,
                  }}
                  selection={selection}
                />
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
