import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  BookOpenTextIcon,
  BooksIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { BookFormat, BookSummary } from "../../shared/api/backend";

const MAX_DISPLAY_NAME_LENGTH = 200;

function formatBadgeLabel(format: BookFormat | undefined): string {
  return format === "epub" ? "EPUB" : "PDF";
}

type LibraryProps = {
  books: BookSummary[];
  loading: boolean;
  error: string;
  busyBookId: string;
  opening: boolean;
  onImport: () => Promise<void>;
  onOpen: (book: BookSummary) => Promise<void>;
  onRelink: (book: BookSummary) => Promise<void>;
  onRemove: (book: BookSummary) => Promise<void>;
  onRename: (book: BookSummary, name: string) => Promise<void>;
};

export function Library({
  books,
  loading,
  error,
  busyBookId,
  opening,
  onImport,
  onOpen,
  onRelink,
  onRemove,
  onRename,
}: LibraryProps) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage === "ja" ? "ja-JP" : "en-US";
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
      void onRename(book, next);
    }
    cancelEdit();
  }

  function formatDate(value: string): string {
    if (!value) return t("library.neverOpened");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("library.recentlyOpened");
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
  }

  function progressLabel(book: BookSummary): string {
    if (book.pageCount < 1) {
      return book.lastPage > 1
        ? t("library.pagesUntil", { page: book.lastPage })
        : t("library.startReading");
    }
    return t("library.pageProgress", { current: book.lastPage, total: book.pageCount });
  }

  return (
    <section className="library" aria-labelledby="library-title">
      <header className="library-heading">
        <div>
          <p className="section-label">{t("library.section")}</p>
          <h1 id="library-title">{t("library.title")}</h1>
          <p>{t("library.description")}</p>
        </div>
        <button
          type="button"
          className="library-import-button"
          onClick={() => void onImport()}
          disabled={opening}
        >
          <PlusIcon size={14} weight="bold" />
          {opening ? t("app.choosingPdf") : t("app.addPdf")}
        </button>
      </header>

      {error && (
        <div className="library-error" role="alert">
          <WarningCircleIcon size={17} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="library-loading" role="status">
          {t("library.loading")}
        </div>
      ) : books.length === 0 ? (
        <div className="library-empty">
          <div className="empty-shelf-mark" aria-hidden="true">
            <BooksIcon size={37} weight="thin" />
            <span />
          </div>
          <p className="section-label">{t("library.emptyKicker")}</p>
          <h2>{t("library.emptyTitle")}</h2>
          <p>{t("library.emptyDescription")}</p>
          <button type="button" className="library-primary-action" onClick={() => void onImport()}>
            <PlusIcon size={16} weight="bold" />
            {t("library.choosePdf")}
          </button>
        </div>
      ) : (
        <div className="book-grid" aria-label={t("library.importedBooks")}>
          {books.map((book) => {
            const progress =
              book.pageCount > 0
                ? Math.min(100, Math.max(2, (book.lastPage / book.pageCount) * 100))
                : 2;
            const busy = busyBookId === book.id;
            return (
              <article
                className={book.available ? "book-card" : "book-card is-missing"}
                key={book.id}
              >
                <button
                  type="button"
                  className="book-cover-button"
                  onClick={() => void onOpen(book)}
                  disabled={!book.available || busy}
                  aria-label={t("library.openBook", { title: book.title })}
                >
                  <span className="book-cover">
                    {book.coverUrl ? (
                      <img src={book.coverUrl} alt="" />
                    ) : (
                      <span className="placeholder-cover" aria-hidden="true">
                        <span className="placeholder-kicker">
                          GLINT / {formatBadgeLabel(book.format)}
                        </span>
                        <strong>{book.title}</strong>
                        <BookOpenTextIcon size={25} weight="thin" />
                      </span>
                    )}
                    <span className="reading-progress" aria-hidden="true">
                      <span style={{ height: `${progress}%` }} />
                    </span>
                    <span className="book-format-badge" aria-hidden="true">
                      {formatBadgeLabel(book.format)}
                    </span>
                    {!book.available && (
                      <span className="missing-cover-state">
                        <WarningCircleIcon size={21} />
                        {t("library.missingFile")}
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
                        aria-label={t("library.displayName", { title: book.title })}
                      />
                    </form>
                  ) : (
                    <h2 title={book.title}>
                      <button
                        type="button"
                        className="book-title-edit"
                        onClick={() => startEdit(book)}
                        disabled={busy}
                        aria-label={t("library.renameBook", { title: book.title })}
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
                        onClick={() => void onRemove(book)}
                        disabled={busy}
                        aria-label={t("library.removeBook", { title: book.title })}
                      >
                        <TrashIcon size={13} weight="bold" />
                        {t("library.remove")}
                      </button>
                      {book.available ? (
                        <button type="button" onClick={() => void onOpen(book)} disabled={busy}>
                          {busy
                            ? t("library.opening")
                            : book.lastPage > 1
                              ? t("library.continue")
                              : t("library.open")}
                          <ArrowRightIcon size={13} weight="bold" />
                        </button>
                      ) : (
                        <button type="button" onClick={() => void onRelink(book)} disabled={busy}>
                          <ArrowCounterClockwiseIcon size={13} weight="bold" />
                          {busy ? t("library.choosing") : t("library.chooseAgain")}
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
