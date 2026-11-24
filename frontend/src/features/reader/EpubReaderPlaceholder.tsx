import { BookOpenTextIcon, CaretLeftIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { BookFile } from "../../shared/api/backend";

type EpubReaderPlaceholderProps = {
  book: BookFile;
  onBack?: () => void;
};

export function EpubReaderPlaceholder({ book, onBack }: EpubReaderPlaceholderProps) {
  const { t } = useTranslation();
  const spineCount = book.spineItems?.length ?? 0;
  return (
    <section
      className="reader ambient is-chrome-visible epub-placeholder"
      aria-label={t("reader.epubPlaceholderAria")}
    >
      <header className="reader-topbar glass">
        <div className="reader-topbar-start">
          {onBack && (
            <button type="button" className="glass-button reader-back" onClick={onBack}>
              <CaretLeftIcon size={15} weight="bold" aria-hidden="true" />
              {t("reader.backToLibrary")}
            </button>
          )}
        </div>
        <div className="reader-title">
          <strong title={book.title}>{book.title}</strong>
        </div>
        <div className="reader-topbar-end" />
      </header>
      <div className="reader-empty">
        <div className="empty-shelf-mark" aria-hidden="true">
          <BookOpenTextIcon size={37} weight="thin" />
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
