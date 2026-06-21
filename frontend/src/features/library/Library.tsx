import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  BookOpenText,
  Books,
  Plus,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import type { BookSummary } from "../../shared/api/backend";

const MAX_DISPLAY_NAME_LENGTH = 200;

type LibraryProps = {
  books: BookSummary[];
  loading: boolean;
  error: string;
  busyBookId: string;
  onImport: () => void;
  onOpen: (book: BookSummary) => void;
  onRelink: (book: BookSummary) => void;
  onRemove: (book: BookSummary) => void;
  onRename: (book: BookSummary, name: string) => void;
};

function formatDate(value: string): string {
  if (!value) {
    return "まだ開いていません";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "最近開いた本";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function progressLabel(book: BookSummary): string {
  if (book.pageCount < 1) {
    return book.lastPage > 1 ? `${book.lastPage}ページまで` : "読み始める";
  }
  return `${book.lastPage} / ${book.pageCount}ページ`;
}

export function Library({
  books,
  loading,
  error,
  busyBookId,
  onImport,
  onOpen,
  onRelink,
  onRemove,
  onRename,
}: LibraryProps) {
  const [editingId, setEditingId] = useState("");
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  function startEdit(book: BookSummary) {
    setEditingId(book.id);
    setDraftName(book.title);
  }

  function cancelEdit() {
    setEditingId("");
    setDraftName("");
  }

  function commitEdit(book: BookSummary) {
    if (editingId !== book.id) {
      return;
    }
    const next = draftName.trim();
    if (next && next !== book.title) {
      onRename(book, next);
    }
    cancelEdit();
  }

  return (
    <section className="library" aria-labelledby="library-title">
      <header className="library-heading">
        <div>
          <p className="section-label">Local library</p>
          <h1 id="library-title">本棚</h1>
          <p>読みかけの技術書へ戻る。PDFと読書位置は、このMacにだけ保存されます。</p>
        </div>
      </header>

      {error && (
        <div className="library-error" role="alert">
          <WarningCircle size={17} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="library-loading" role="status">本棚を読み込んでいます…</div>
      ) : books.length === 0 ? (
        <div className="library-empty">
          <div className="empty-shelf-mark" aria-hidden="true">
            <Books size={37} weight="thin" />
            <span />
          </div>
          <p className="section-label">First volume</p>
          <h2>最初の一冊を、本棚へ。</h2>
          <p>検索可能な技術書PDFを追加すると、表紙と読書位置をローカルに保存します。</p>
          <button type="button" className="library-primary-action" onClick={onImport}>
            <Plus size={16} weight="bold" />
            PDFを選ぶ
          </button>
        </div>
      ) : (
        <div className="book-grid" aria-label="import済みの本">
          {books.map((book) => {
            const progress = book.pageCount > 0
              ? Math.min(100, Math.max(2, (book.lastPage / book.pageCount) * 100))
              : 2;
            const busy = busyBookId === book.id;
            return (
              <article className={book.available ? "book-card" : "book-card is-missing"} key={book.id}>
                <button
                  type="button"
                  className="book-cover-button"
                  onClick={() => onOpen(book)}
                  disabled={!book.available || busy}
                  aria-label={`${book.title}を開く`}
                >
                  <span className="book-cover">
                    {book.coverUrl ? (
                      <img src={book.coverUrl} alt="" />
                    ) : (
                      <span className="placeholder-cover" aria-hidden="true">
                        <span className="placeholder-kicker">GLINT / PDF</span>
                        <strong>{book.title}</strong>
                        <BookOpenText size={25} weight="thin" />
                      </span>
                    )}
                    <span className="reading-progress" aria-hidden="true">
                      <span style={{ height: `${progress}%` }} />
                    </span>
                    {!book.available && (
                      <span className="missing-cover-state">
                        <WarningCircle size={21} />
                        ファイルが見つかりません
                      </span>
                    )}
                  </span>
                </button>
                <div className="book-card-copy">
                  {editingId === book.id ? (
                    <form
                      className="book-rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        commitEdit(book);
                      }}
                    >
                      <input
                        ref={inputRef}
                        className="book-rename-input"
                        type="text"
                        value={draftName}
                        maxLength={MAX_DISPLAY_NAME_LENGTH}
                        onChange={(event) => setDraftName(event.target.value)}
                        onBlur={() => commitEdit(book)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEdit();
                          }
                        }}
                        aria-label={`${book.title}の表示名`}
                      />
                    </form>
                  ) : (
                    <h2 title={book.title}>
                      <button
                        type="button"
                        className="book-title-edit"
                        onClick={() => startEdit(book)}
                        disabled={busy}
                        aria-label={`${book.title}の名前を変更`}
                      >
                        {book.title}
                      </button>
                    </h2>
                  )}
                  <p className="book-progress-copy">{progressLabel(book)}</p>
                  <div className="book-card-footer">
                    <span>{formatDate(book.lastOpenedAt)}</span>
                    <div className="book-card-actions">
                      <button
                        type="button"
                        className="book-card-remove"
                        onClick={() => onRemove(book)}
                        disabled={busy}
                        aria-label={`${book.title}を本棚から削除`}
                      >
                        <Trash size={13} weight="bold" />
                        削除
                      </button>
                      {book.available ? (
                        <button type="button" onClick={() => onOpen(book)} disabled={busy}>
                          {busy ? "開いています…" : book.lastPage > 1 ? "続きを読む" : "開く"}
                          <ArrowRight size={13} weight="bold" />
                        </button>
                      ) : (
                        <button type="button" onClick={() => onRelink(book)} disabled={busy}>
                          <ArrowCounterClockwise size={13} weight="bold" />
                          {busy ? "選択中…" : "再選択"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
