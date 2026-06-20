import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { BookOpenText, FolderOpen } from "@phosphor-icons/react";
import { ChatSidebar } from "./features/chat/ChatSidebar";
import { PdfReader } from "./features/reader/PdfReader";
import { openPDF, type BookFile } from "./shared/api/backend";

type PageContext = {
  pageNumber: number;
  text: string;
};

export default function App() {
  const [book, setBook] = useState<BookFile | null>(null);
  const [pageContext, setPageContext] = useState<PageContext>({ pageNumber: 0, text: "" });
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [assistantWidth, setAssistantWidth] = useState(390);
  const resizeState = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePageContextChange = useCallback((pageNumber: number, text: string) => {
    setPageContext({ pageNumber, text });
  }, []);

  async function handleOpenPDF() {
    setOpening(true);
    setOpenError("");
    try {
      const selected = await openPDF();
      if (selected.url) {
        setBook(selected);
      }
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : "PDFを開けませんでした。");
    } finally {
      setOpening(false);
    }
  }

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

  const workspaceStyle = {
    "--assistant-width": `${assistantWidth}px`,
  } as CSSProperties;

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
            {book && <BookOpenText size={15} weight="regular" />}
            <span>{book?.name ?? "本はまだ開かれていません"}</span>
          </div>
          <div className="toolbar-actions">
            {openError && <span className="open-error" role="alert">{openError}</span>}
            <button type="button" className="open-book-button" onClick={handleOpenPDF} disabled={opening}>
              <FolderOpen size={16} weight="regular" />
              {opening ? "開いています…" : book ? "別のPDF" : "PDFを開く"}
            </button>
          </div>
        </header>

        <div className="workspace" style={workspaceStyle}>
          <aside className="reading-rail" aria-label="Reading status">
            <div className="rail-mark" aria-hidden="true">G</div>
            <div className="rail-mode">
              <BookOpenText size={18} weight="regular" />
              <span>READING</span>
            </div>
            <div className="rail-position" aria-label={pageContext.pageNumber ? `${pageContext.pageNumber}ページ` : "ページ未選択"}>
              <span className={pageContext.pageNumber ? "rail-tick is-current" : "rail-tick"} />
              <span className="rail-page">{pageContext.pageNumber ? String(pageContext.pageNumber).padStart(3, "0") : "—"}</span>
            </div>
          </aside>

          <PdfReader book={book} onPageContextChange={handlePageContextChange} />

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
              if (event.key === "ArrowLeft") {
                setAssistantWidth((width) => Math.min(520, width + 12));
              }
              if (event.key === "ArrowRight") {
                setAssistantWidth((width) => Math.max(328, width - 12));
              }
            }}
          >
            <span />
          </div>

          <ChatSidebar
            context={{
              bookName: book?.name ?? "",
              pageNumber: pageContext.pageNumber,
              text: pageContext.text,
            }}
          />
        </div>
      </main>
    </Tooltip.Provider>
  );
}
