import { BookmarkSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { HighlightColor } from "../api";

type ListEntry = {
  key: string | number;
  active: boolean;
  goLabel: string;
  removeLabel: string;
  onGo: () => void;
  onRemove: () => void;
};

type ListState = {
  loaded: boolean;
  /** Shown in place of the list when it is empty. */
  error: string;
  busy: boolean;
};

export type BookmarkEntry = ListEntry & { title: string; detail: string };

type BookmarkListProps = ListState & {
  entries: BookmarkEntry[];
  emptyMessage: string;
};

/** The bookmarks in the side sheet. */
export function BookmarkList({ loaded, error, busy, entries, emptyMessage }: BookmarkListProps) {
  const { t } = useTranslation();
  return (
    <div className="reader-sheet-scroll">
      {loaded ? (
        entries.length === 0 ? (
          <p className={`reader-sheet-message${error ? " is-error" : ""}`}>
            {error || emptyMessage}
          </p>
        ) : (
          <ol className="reader-bookmark-list">
            {entries.map((entry) => (
              <li key={entry.key} className={entry.active ? "is-active" : ""}>
                <button
                  type="button"
                  className="reader-bookmark-link"
                  aria-label={entry.goLabel}
                  onClick={entry.onGo}
                >
                  <BookmarkSimpleIcon size={15} weight="fill" aria-hidden="true" />
                  <span>
                    <strong>{entry.title}</strong>
                    <small>{entry.detail}</small>
                  </span>
                </button>
                <RemoveButton label={entry.removeLabel} busy={busy} onRemove={entry.onRemove} />
              </li>
            ))}
          </ol>
        )
      ) : (
        <p className="reader-sheet-message">{t("reader.loadingBookmarks")}</p>
      )}
    </div>
  );
}

export type HighlightEntry = ListEntry & { color: HighlightColor; place: string; text: string };

type HighlightListProps = ListState & { entries: HighlightEntry[] };

/** The highlights in the side sheet. */
export function HighlightList({ loaded, error, busy, entries }: HighlightListProps) {
  const { t } = useTranslation();
  return (
    <div className="reader-sheet-scroll">
      {loaded ? (
        entries.length === 0 ? (
          <p className={`reader-sheet-message${error ? " is-error" : ""}`}>
            {error || t("reader.noHighlights")}
          </p>
        ) : (
          <ol className="reader-highlight-list">
            {entries.map((entry) => (
              <li
                key={entry.key}
                className={`is-${entry.color}${entry.active ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="reader-highlight-link"
                  aria-label={entry.goLabel}
                  onClick={entry.onGo}
                >
                  <small>{entry.place}</small>
                  <span>{entry.text}</span>
                </button>
                <RemoveButton label={entry.removeLabel} busy={busy} onRemove={entry.onRemove} />
              </li>
            ))}
          </ol>
        )
      ) : (
        <p className="reader-sheet-message">{t("reader.loadingHighlights")}</p>
      )}
    </div>
  );
}

function RemoveButton({
  label,
  busy,
  onRemove,
}: {
  label: string;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      className="reader-bookmark-remove"
      aria-label={label}
      disabled={busy}
      onClick={onRemove}
    >
      <XIcon size={12} weight="bold" aria-hidden="true" />
    </button>
  );
}
