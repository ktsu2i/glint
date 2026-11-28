import type { ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { ReaderPanel } from "./ReaderTopBar";

type ReaderSheetProps = {
  panel: ReaderPanel;
  /** How many entries the panel lists; shown next to the title when above 0. */
  count: number;
  onClose: () => void;
  children: ReactNode;
};

/** The side sheet that holds the table of contents, search, bookmarks, or highlights. */
export function ReaderSheet({ panel, count, onClose, children }: ReaderSheetProps) {
  const { t } = useTranslation();
  const titles = {
    toc: t("reader.toc"),
    search: t("reader.textSearch"),
    bookmarks: t("reader.bookmarks"),
    highlights: t("reader.highlights"),
  } satisfies Record<ReaderPanel, string>;
  const title = titles[panel];

  return (
    <aside className={`reader-sheet glass glass-strong reader-sheet-${panel}`} aria-label={title}>
      <div className="reader-sheet-header">
        <h2>{title}</h2>
        {count > 0 && <strong className="reader-sheet-count">{count}</strong>}
        <button
          type="button"
          className="glass-button reader-sheet-close"
          aria-label={t("reader.closePanel")}
          onClick={onClose}
        >
          <XIcon size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
      {children}
    </aside>
  );
}
