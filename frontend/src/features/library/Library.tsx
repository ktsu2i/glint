import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  BookOpenTextIcon,
  BooksIcon,
  PencilSimpleIcon,
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

function readingProgress(book: BookSummary): number {
  if (book.pageCount < 1) {
    return 0;
  }
  return Math.min(100, Math.max(0, (book.lastPage / book.pageCount) * 100));
}

// The hero shows the available book the user opened most recently.
function mostRecentBook(books: BookSummary[]): BookSummary | null {
  let recent: BookSummary | null = null;
  let recentTime = Number.NEGATIVE_INFINITY;
  for (const book of books) {
    if (!book.available || !book.lastOpenedAt) {
      continue;
    }
    const time = new Date(book.lastOpenedAt).getTime();
    if (!Number.isNaN(time) && time > recentTime) {
      recent = book;
      recentTime = time;
    }
  }
  return recent;
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
  const { t } = useTranslation();
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

  function progressLabel(book: BookSummary): string {
    if (!book.lastOpenedAt) {
      return t("library.neverOpened");
    }
    if (book.pageCount < 1) {
      return book.lastPage > 1
        ? t("library.pagesUntil", { page: book.lastPage })
        : t("library.startReading");
    }
    return t("library.pageProgress", { current: book.lastPage, total: book.pageCount });
  }

  function primaryActionLabel(book: BookSummary, busy: boolean): string {
    if (!book.available) {
      return busy ? t("library.choosing") : t("library.chooseAgain");
    }
    if (busy) {
      return t("library.opening");
    }
    if (book.lastPage > 1) {
      return t("library.continue");
    }
    return book.lastOpenedAt ? t("library.open") : t("library.startReading");
  }

  const recent = mostRecentBook(books);

  return (
    <section className="library" aria-labelledby="library-title">
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
        <div className="library-empty glass">
          <div className="empty-shelf-mark" aria-hidden="true">
            <BooksIcon size={37} weight="thin" />
          </div>
          <h2>{t("library.emptyTitle")}</h2>
          <p>{t("library.emptyDescription")}</p>
          <button
            type="button"
            className="solid-button"
            onClick={() => void onImport()}
            disabled={opening}
          >
            <PlusIcon size={14} weight="bold" />
            {t("library.choosePdf")}
          </button>
        </div>
      ) : (
        <>
          {recent && (
            <section className="library-hero" aria-label={t("library.recentlyOpened")}>
              <span className="library-hero-cover" aria-hidden="true">
                {recent.coverUrl ? (
                  <img src={recent.coverUrl} alt="" />
                ) : (
                  <PlaceholderCover book={recent} />
                )}
              </span>
              <div className="library-hero-copy">
                <p>{t("library.recentlyOpened")}</p>
                <h2 title={recent.title}>{recent.title}</h2>
                <span>{progressLabel(recent)}</span>
                <span className="library-hero-progress" aria-hidden="true">
                  <span style={{ width: `${readingProgress(recent)}%` }} />
                </span>
                <button
                  type="button"
                  className="solid-button"
                  aria-label={t("library.continueBook", { title: recent.title })}
                  disabled={busyBookId === recent.id}
                  onClick={() => void onOpen(recent)}
                >
                  {busyBookId === recent.id ? t("library.opening") : t("library.continue")}
                </button>
              </div>
            </section>
          )}

          <section className="library-shelf glass" aria-label={t("library.importedBooks")}>
            <header className="library-shelf-heading">
              <h2>
                {t("library.title")} <span>{t("library.bookCount", { count: books.length })}</span>
              </h2>
              <p>{t("library.description")}</p>
            </header>
            <div className="book-grid">
              {books.map((book) => {
                const busy = busyBookId === book.id;
                const actionIsPrimary = book.available && book.lastPage > 1;
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
                          <PlaceholderCover book={book} />
                        )}
                        <span className="book-format-badge" aria-hidden="true">
                          {formatBadgeLabel(book.format)}
                        </span>
                        <span className="reading-progress" aria-hidden="true">
                          <span style={{ width: `${readingProgress(book)}%` }} />
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
                        <h3 title={book.title}>
                          <button
                            type="button"
                            className="book-title-edit"
                            onClick={() => startEdit(book)}
                            disabled={busy}
                            aria-label={t("library.renameBook", { title: book.title })}
                          >
                            <span>{book.title}</span>
                            <PencilSimpleIcon size={12} aria-hidden="true" />
                          </button>
                        </h3>
                      )}
                      {book.available && (
                        <p className="book-progress-copy">{progressLabel(book)}</p>
                      )}
                      <div className="book-card-actions">
                        <button
                          type="button"
                          className={
                            actionIsPrimary ? "book-card-action is-primary" : "book-card-action"
                          }
                          onClick={() => void (book.available ? onOpen(book) : onRelink(book))}
                          disabled={busy}
                        >
                          {!book.available && (
                            <ArrowCounterClockwiseIcon size={12} weight="bold" aria-hidden="true" />
                          )}
                          {primaryActionLabel(book, busy)}
                        </button>
                        <button
                          type="button"
                          className="book-card-remove"
                          onClick={() => void onRemove(book)}
                          disabled={busy}
                          aria-label={t("library.removeBook", { title: book.title })}
                        >
                          <TrashIcon size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function PlaceholderCover({ book }: { book: BookSummary }) {
  return (
    <span className="placeholder-cover" aria-hidden="true">
      <span className="placeholder-kicker">{formatBadgeLabel(book.format)}</span>
      <strong>{book.title}</strong>
      <BookOpenTextIcon size={22} weight="thin" />
    </span>
  );
}
