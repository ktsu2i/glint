import { lazy, Suspense, useCallback, useState } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { LibraryScreen } from "../features/library/LibraryScreen";
import { useLibrarySortOrder } from "../features/library/librarySort";
import { useBookIndexing, useCoverGeneration } from "../features/library/useBookPreparation";
import { useLibraryActions } from "../features/library/useLibraryActions";
import { useLibraryBooks } from "../features/library/useLibraryBooks";
import { useLibrarySearch } from "../features/library/useLibrarySearch";
import { useReadingPosition } from "../features/reader/useReadingPosition";
import type { BookFile, BookSummary } from "../shared/api/books";
import { I18nProvider } from "../shared/i18n/i18n";
import { useAppTheme } from "./useAppTheme";

// The readers, and PDF.js and foliate-js behind them, load when a book is
// first opened so the library starts without them.
const EpubReader = lazy(async () => ({
  default: (await import("../features/reader/epub/EpubReader")).EpubReader,
}));
const PdfReader = lazy(async () => ({
  default: (await import("../features/reader/pdf/PdfReader")).PdfReader,
}));

type View = "library" | "search" | "reader";

function AppContent() {
  const [view, setView] = useState<View>("library");
  const [book, setBook] = useState<BookFile | null>(null);
  useAppTheme();

  const library = useLibraryBooks();
  const sort = useLibrarySortOrder();
  const search = useLibrarySearch(view === "search");
  const position = useReadingPosition(book);
  const { refresh } = library;

  const ensureCover = useCoverGeneration(refresh);
  const ensureBookIndexed = useBookIndexing(
    useCallback(
      (bookId: string, result: { persistedCount: number; pageCount: number }) => {
        setBook((current) =>
          current?.id === bookId
            ? {
                ...current,
                indexedPageCount: result.persistedCount,
                nextSegment: result.pageCount + 1,
              }
            : current,
        );
        void refresh();
      },
      [refresh],
    ),
  );

  const { reset: resetPosition } = position;
  const showReader = useCallback(
    (selected: BookFile) => {
      resetPosition();
      setBook(selected);
      setView("reader");
      if (selected.format !== "epub") {
        void ensureCover(selected);
      }
      void ensureBookIndexed(selected);
    },
    [ensureCover, ensureBookIndexed, resetPosition],
  );

  const actions = useLibraryActions(library, {
    onOpen: showReader,
    onRenamed: (renamed: BookSummary) =>
      setBook((current) =>
        current?.id === renamed.id ? { ...current, title: renamed.title } : current,
      ),
  });

  const showLibrary = useCallback(() => {
    setView("library");
    void refresh();
  }, [refresh]);

  const openSearch = useCallback(() => setView("search"), []);

  const { clear: clearSearch } = search;
  const closeSearch = useCallback(() => {
    clearSearch();
    setView("library");
  }, [clearSearch]);

  return (
    <Tooltip.Provider delay={500} closeDelay={80}>
      <main className="app-shell">
        {view === "reader" ? (
          <div className="workspace">
            <Suspense fallback={null}>
              {book?.format === "epub" ? (
                <EpubReader
                  key={`${book.id}:${book.initialPage}`}
                  book={book}
                  initialSection={book.initialPage}
                  onPageChange={position.save}
                  onBack={showLibrary}
                />
              ) : (
                <PdfReader
                  key={book ? `${book.id}:${book.url}:${book.initialPage}` : "none"}
                  book={book}
                  initialPage={book?.initialPage ?? 1}
                  onPageChange={position.save}
                  onBack={showLibrary}
                />
              )}
            </Suspense>
          </div>
        ) : (
          <LibraryScreen
            mode={view === "search" ? "search" : "shelf"}
            library={library}
            search={search}
            actions={actions}
            sort={sort}
            onOpenSearch={openSearch}
            onCloseSearch={closeSearch}
          />
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
