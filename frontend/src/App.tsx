import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { ArrowLeft, BookOpenText, Books, FolderOpen, GearSix } from "@phosphor-icons/react";
import { ChatSidebar } from "./features/chat/ChatSidebar";
import { generateCoverThumbnail } from "./features/library/generateCover";
import { Library } from "./features/library/Library";
import { PdfReader, type ReaderSelection } from "./features/reader/PdfReader";
import { LLMSettingsPage } from "./features/settings/LLMSettingsPage";
import {
  listBooks,
  markBookCoverFailed,
  openBook,
  openPDF,
  relinkPDF,
  removeBook,
  saveBookCover,
  saveReadingPosition,
  type BookFile,
  type BookSummary,
} from "./shared/api/backend";

type PageContext = {
  pageNumber: number;
  text: string;
};

export default function App() {
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
  const [openError, setOpenError] = useState("");
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
      setLibraryError(reason instanceof Error ? reason.message : "本棚を読み込めませんでした。");
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLibrary(true);
  }, [refreshLibrary]);

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
    setOpenError("");
    void ensureCover(selected);
  }, [ensureCover]);

  const handleSelectionChange = useCallback((next: ReaderSelection | null) => {
    setSelection(next);
  }, []);

  async function handleImportPDF() {
    setOpening(true);
    setOpenError("");
    setLibraryError("");
    try {
      const selected = await openPDF();
      if (selected.url) {
        showReader(selected);
        await refreshLibrary();
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "PDFを追加できませんでした。";
      view === "library" ? setLibraryError(message) : setOpenError(message);
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
      setLibraryError(reason instanceof Error ? reason.message : "本を開けませんでした。");
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
      setLibraryError(reason instanceof Error ? reason.message : "本を削除できませんでした。");
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
      setLibraryError(reason instanceof Error ? reason.message : "PDFを再選択できませんでした。");
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
      setOpenError(reason instanceof Error ? reason.message : "読書位置を保存できませんでした。");
    });
  }, [book]);

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
    const returnView = view === "reader" && book ? "reader" : "library";
    if (returnView === "reader" && pageContext.pageNumber > 0) {
      setBook((current) => current ? { ...current, initialPage: pageContext.pageNumber } : current);
    }
    setSettingsReturnView(returnView);
    setView("settings");
    setOpenError("");
  }, [book, pageContext.pageNumber, view]);

  const closeSettings = useCallback(() => {
    setView(settingsReturnView === "reader" && book ? "reader" : "library");
  }, [book, settingsReturnView]);

  return (
    <Tooltip.Provider delay={500} closeDelay={80}>
      <main className="app-shell">
        <header className="app-toolbar">
          <div className="window-brand" aria-label="Glint">
            <span className="wordmark">GLINT</span>
            <span className="toolbar-divider" />
            <span className="workspace-label">Technical reader</span>
          </div>
          <div className="toolbar-book" title={book?.name}>
            {view === "reader" && book ? <BookOpenText size={15} /> : view === "settings" ? <GearSix size={15} /> : <Books size={15} />}
            <span>{view === "reader" ? book?.title : view === "settings" ? "Settings" : "Library"}</span>
          </div>
          <div className="toolbar-actions">
            {openError && <span className="open-error" role="alert">{openError}</span>}
            {view === "reader" && (
              <button
                type="button"
                className="library-back-button"
                onClick={() => {
                  setView("library");
                  setBook(null);
                  setOpenError("");
                  void refreshLibrary();
                }}
              >
                <Books size={15} />
                本棚へ
              </button>
            )}
            {view === "settings" ? (
              <button type="button" className="library-back-button" onClick={closeSettings}>
                <ArrowLeft size={15} />
                {settingsReturnView === "reader" && book ? "読書へ戻る" : "本棚へ戻る"}
              </button>
            ) : (
              <>
                <button type="button" className="toolbar-settings-button" onClick={openSettings} aria-label="設定を開く">
                  <GearSix size={16} />
                  設定
                </button>
                <button type="button" className="open-book-button" onClick={handleImportPDF} disabled={opening}>
                  <FolderOpen size={16} />
                  {opening ? "選択しています…" : "PDFを追加"}
                </button>
              </>
            )}
          </div>
        </header>

        {view === "settings" ? (
          <LLMSettingsPage onBack={closeSettings} />
        ) : view === "library" ? (
          <Library
            books={books}
            loading={libraryLoading}
            error={libraryError}
            busyBookId={busyBookId}
            onImport={handleImportPDF}
            onOpen={handleOpenBook}
            onRelink={handleRelinkBook}
            onRemove={handleRemoveBook}
          />
        ) : (
          <div className="workspace" style={workspaceStyle}>
            <aside className="reading-rail" aria-label="Reading status">
              <div className="rail-position" aria-label={pageContext.pageNumber ? `${pageContext.pageNumber}ページ` : "ページ未選択"}>
                <span className={pageContext.pageNumber ? "rail-tick is-current" : "rail-tick"} />
                <span className="rail-page">{pageContext.pageNumber ? String(pageContext.pageNumber).padStart(3, "0") : "—"}</span>
              </div>
            </aside>

            <PdfReader
              book={book}
              initialPage={book?.initialPage ?? 1}
              onPageContextChange={handlePageContextChange}
              onSelectionChange={handleSelectionChange}
            />

            <div
              className="panel-resizer"
              role="separator"
              aria-label="アシスタントパネルの幅を変更"
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
              onOpenSettings={openSettings}
            />
          </div>
        )}
      </main>
    </Tooltip.Provider>
  );
}
