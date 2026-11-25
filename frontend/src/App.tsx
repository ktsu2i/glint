import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { useTranslation } from "react-i18next";
import { generateCoverThumbnail } from "./features/library/generateCover";
import { indexBookPages, isAbortError, type IndexableBook } from "./features/library/indexer";
import { Library } from "./features/library/Library";
import { LibraryTopBar } from "./features/library/LibraryTopBar";
import {
  LibrarySearchField,
  LibrarySearchResults,
  type LibrarySearchStatus,
} from "./features/library/LibrarySearch";
import { EpubReaderPlaceholder } from "./features/reader/EpubReaderPlaceholder";
import { PdfReader } from "./features/reader/PdfReader";
import { syncDocumentTheme } from "./features/settings/theme";
import { onAppearanceChanged } from "./shared/api/events";
import { I18nProvider } from "./shared/i18n/i18n";
import {
  getAppearanceSettings,
  listBooks,
  markBookCoverFailed,
  openBook,
  openBookFile,
  pendingIndexBooks,
  relinkBook,
  removeBook,
  renameBook,
  saveBookCover,
  saveReadingPosition,
  searchLibrary,
  type BookFile,
  type BookSummary,
  type LibrarySearchHit,
  type ThemePreference,
} from "./shared/api/backend";

function AppContent() {
  const { t } = useTranslation();
  const [view, setView] = useState<"library" | "search" | "reader">("library");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [busyBookId, setBusyBookId] = useState("");
  const [book, setBook] = useState<BookFile | null>(null);
  const [opening, setOpening] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LibrarySearchHit[]>([]);
  const [searchStatus, setSearchStatus] = useState<LibrarySearchStatus>("idle");
  const [searchError, setSearchError] = useState("");
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const indexAbortersRef = useRef<Map<string, AbortController>>(new Map());
  const searchRequestRef = useRef(0);
  const generatingCovers = useRef(new Set<string>());
  const lastSavedPosition = useRef("");

  const refreshLibrary = useCallback(
    async (showLoading = false) => {
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
    },
    [t],
  );

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 初回 load。loading の初期値は true で、setState は await 後に行われる。
    void refreshLibrary();
  }, [refreshLibrary]);

  useLayoutEffect(() => syncDocumentTheme(theme), [theme]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const loaded = await getAppearanceSettings();
        if (active) setTheme(loaded.theme);
      } catch (reason) {
        console.warn(reason instanceof Error ? reason.message : t("error.loadAppearance"));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [t]);

  // The settings window saves the theme; follow it here as well.
  useEffect(() => onAppearanceChanged(setTheme), []);

  const ensureCover = useCallback(
    async (selected: BookFile) => {
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
        } catch {}
      } finally {
        generatingCovers.current.delete(selected.id);
        await refreshLibrary();
      }
    },
    [refreshLibrary],
  );

  const ensureBookIndexed = useCallback(
    async (target: IndexableBook) => {
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
      try {
        const result = await indexBookPages(
          { id: target.id, url: target.url, nextSegment: target.nextSegment },
          { signal: controller.signal },
        );
        setBook((current) =>
          current && current.id === target.id
            ? {
                ...current,
                indexedPageCount: result.persistedCount,
                nextSegment: result.pageCount + 1,
              }
            : current,
        );
        void refreshLibrary();
      } catch (reason: unknown) {
        if (isAbortError(reason)) {
          return;
        }
        console.warn("Book indexing failed", reason);
      } finally {
        indexAbortersRef.current.delete(target.id);
      }
    },
    [refreshLibrary],
  );

  const resumedPendingIndex = useRef(false);
  useEffect(() => {
    if (resumedPendingIndex.current) {
      return;
    }
    resumedPendingIndex.current = true;
    const resume = async () => {
      let targets;
      try {
        targets = await pendingIndexBooks();
      } catch (reason: unknown) {
        console.warn("Listing books to index failed", reason);
        return;
      }
      for (const target of targets) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 裏で1冊ずつ順番に index する。
        await ensureBookIndexed(target);
      }
    };
    void resume();
  }, [ensureBookIndexed]);

  useEffect(() => {
    const aborters = indexAbortersRef.current;
    return () => {
      aborters.forEach((controller) => controller.abort());
      aborters.clear();
    };
  }, []);

  const showReader = useCallback(
    (selected: BookFile) => {
      lastSavedPosition.current = "";
      setBook(selected);
      setView("reader");
      if (selected.format !== "epub") {
        void ensureCover(selected);
      }
      void ensureBookIndexed(selected);
    },
    [ensureCover, ensureBookIndexed],
  );

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
      setBooks((current) => current.map((entry) => (entry.id === renamed.id ? renamed : entry)));
      setBook((current) =>
        current && current.id === renamed.id ? { ...current, title: renamed.title } : current,
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

  const handlePageChange = useCallback(
    (pageNumber: number, pageCount: number) => {
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
    },
    [book, t],
  );

  const showLibrary = useCallback(() => {
    setView("library");
    void refreshLibrary();
  }, [refreshLibrary]);

  const showSearch = useCallback(() => {
    setView("search");
    setSearchFocusSignal((current) => current + 1);
  }, []);

  const closeSearch = useCallback(() => {
    handleLibrarySearchClear();
    setView("library");
  }, [handleLibrarySearchClear]);

  useEffect(() => {
    if (view !== "library" && view !== "search") {
      return;
    }
    function openLibrarySearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        showSearch();
      }
    }
    window.addEventListener("keydown", openLibrarySearch);
    return () => window.removeEventListener("keydown", openLibrarySearch);
  }, [showSearch, view]);

  return (
    <Tooltip.Provider delay={500} closeDelay={80}>
      <main className="app-shell">
        {view === "reader" ? (
          <div className="workspace">
            {book?.format === "epub" ? (
              <EpubReaderPlaceholder book={book} onBack={showLibrary} />
            ) : (
              <PdfReader
                book={book}
                initialPage={book?.initialPage ?? 1}
                onPageChange={handlePageChange}
                onBack={showLibrary}
              />
            )}
          </div>
        ) : (
          <div className="library-screen ambient">
            <LibraryTopBar
              title={t("app.library")}
              opening={opening}
              search={
                view === "search" ? (
                  <LibrarySearchField
                    key={searchFocusSignal}
                    searchInput={searchInput}
                    searchStatus={searchStatus}
                    resultCount={searchResults.length}
                    onSearchInputChange={setSearchInput}
                    onSearchSubmit={handleLibrarySearchSubmit}
                    onClose={closeSearch}
                  />
                ) : null
              }
              onImport={() => void handleImportPDF()}
              onSearch={showSearch}
            />
            <div className="library-content">
              {view === "search" ? (
                <LibrarySearchResults
                  busyBookId={busyBookId}
                  searchQuery={searchQuery}
                  searchInput={searchInput}
                  searchResults={searchResults}
                  searchStatus={searchStatus}
                  searchError={searchError}
                  onOpenAtPage={handleOpenBookAtPage}
                />
              ) : (
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
              )}
            </div>
          </div>
        )}
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
