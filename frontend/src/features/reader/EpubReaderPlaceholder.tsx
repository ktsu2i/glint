import { BookOpenTextIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { BookFile } from "../../shared/api/backend";

type EpubReaderPlaceholderProps = {
  book: BookFile;
};

// EpubReaderPlaceholder fills the reader workspace until the foliate-js based
// EpubReader lands in Phase E3. It keeps the rest of the workspace (toolbar,
// chat sidebar, library navigation) usable so an EPUB import is not a dead
// end even before the real renderer ships.
export function EpubReaderPlaceholder({ book }: EpubReaderPlaceholderProps) {
  const { t } = useTranslation();
  const spineCount = book.spineItems?.length ?? 0;
  return (
    <section className="reader epub-placeholder" aria-label={t("reader.epubPlaceholderAria")}>
      <div className="reader-empty">
        <div className="empty-shelf-mark" aria-hidden="true">
          <BookOpenTextIcon size={37} weight="thin" />
          <span />
        </div>
        <p className="section-label">{t("reader.epubPlaceholderKicker")}</p>
        <h2>{t("reader.epubPlaceholderTitle")}</h2>
        <p>{t("reader.epubPlaceholderBody")}</p>
        {spineCount > 0 && (
          <p className="reader-empty-meta">
            {t("reader.epubPlaceholderSpine", { count: spineCount })}
          </p>
        )}
      </div>
    </section>
  );
}
