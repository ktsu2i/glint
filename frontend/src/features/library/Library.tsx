import { useEffect, useRef, useState } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
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
import type { BookFormat, BookSummary } from "../../shared/api/books";
import { readingProgress } from "./librarySort";

const MAX_DISPLAY_NAME_LENGTH = 200;

function formatBadgeLabel(format: BookFormat | undefined): string {
  return format === "epub" ? "EPUB" : "PDF";
}

// The hero offers to continue the available book the user opened most recently.
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
    if (book.format === "epub") {
      return book.pageCount < 1
        ? t("library.startReading")
        : t("library.percentRead", { percent: Math.round(readingProgress(book)) });
    }
    if (book.pageCount < 1) {
      return book.lastPage > 1
        ? t("library.pagesUntil", { page: book.lastPage })
        : t("library.startReading");
    }
    return t("library.pageProgress", { current: book.lastPage, total: book.pageCount });
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
            {t("library.chooseBook")}
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
                <h2 title={recent.title}>{recent.title}</h2>
                <div className="library-hero-progress-row">
                  <span className="library-hero-progress" aria-hidden="true">
                    <span style={{ width: `${readingProgress(recent)}%` }} />
                  </span>
                  <span>{progressLabel(recent)}</span>
                </div>
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
            <div className="book-grid">
              {books.map((book) => {
                const busy = busyBookId === book.id;
                return (
                  <ContextMenu.Root key={book.id} disabled={busy}>
                    <ContextMenu.Trigger
                      render={<article />}
                      className={book.available ? "book-card" : "book-card is-missing"}
                    >
                      <button
                        type="button"
                        className="book-cover-button"
                        onClick={() => void (book.available ? onOpen(book) : onRelink(book))}
                        disabled={busy}
                        aria-label={
                          book.available
                            ? t("library.openBook", { title: book.title })
                            : t("library.relinkBook", { title: book.title })
                        }
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
                              <small>
                                <ArrowCounterClockwiseIcon
                                  size={11}
                                  weight="bold"
                                  aria-hidden="true"
                                />
                                {busy ? t("library.choosing") : t("library.chooseAgain")}
                              </small>
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
                          <h2 title={book.title}>{book.title}</h2>
                        )}
                        {book.available && (
                          <p className="book-progress-copy">
                            {busy ? t("library.opening") : progressLabel(book)}
                          </p>
                        )}
                      </div>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Positioner className="book-menu-positioner">
                        <ContextMenu.Popup
                          className="book-menu glass"
                          aria-label={t("library.bookMenu", { title: book.title })}
                          finalFocus={() => inputRef.current ?? true}
                        >
                          <ContextMenu.Item
                            className="book-menu-item"
                            onClick={() => startEdit(book)}
                          >
                            <PencilSimpleIcon size={14} aria-hidden="true" />
                            {t("library.rename")}
                          </ContextMenu.Item>
                          {!book.available && (
                            <ContextMenu.Item
                              className="book-menu-item"
                              onClick={() => void onRelink(book)}
                            >
                              <ArrowCounterClockwiseIcon size={14} aria-hidden="true" />
                              {t("library.chooseFileAgain")}
                            </ContextMenu.Item>
                          )}
                          <ContextMenu.Separator className="book-menu-separator" />
                          <ContextMenu.Item
                            className="book-menu-item is-danger"
                            onClick={() => void onRemove(book)}
                          >
                            <TrashIcon size={14} aria-hidden="true" />
                            {t("library.removeFromLibrary")}
                          </ContextMenu.Item>
                        </ContextMenu.Popup>
                      </ContextMenu.Positioner>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
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
