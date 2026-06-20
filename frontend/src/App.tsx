import { useCallback, useState } from "react";
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">G</div>
          <div>
            <h1>Glint</h1>
            <p>Books, grounded in your code.</p>
          </div>
        </div>
        <div className="header-actions">
          {openError && <span className="open-error" role="alert">{openError}</span>}
          <button type="button" className="open-book-button" onClick={handleOpenPDF} disabled={opening}>
            <span>＋</span> {opening ? "開いています…" : book ? "別のPDFを開く" : "PDFを開く"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <PdfReader book={book} onPageContextChange={handlePageContextChange} />
        <ChatSidebar
          context={{
            bookName: book?.name ?? "",
            pageNumber: pageContext.pageNumber,
            text: pageContext.text,
          }}
        />
      </div>
    </main>
  );
}
