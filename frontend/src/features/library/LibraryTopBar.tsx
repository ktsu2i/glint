import type { ReactElement } from "react";
import { BookOpenTextIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

type LibraryTopBarProps = {
  title: string;
  resumeTitle: string | null;
  opening: boolean;
  search: ReactElement | null;
  onImport: () => void;
  onResume: () => void;
  onSearch: () => void;
};

// LibraryTopBar is the floating glass bar of the library. While searching,
// the title and the search button give way to the search field.
export function LibraryTopBar({
  title,
  resumeTitle,
  opening,
  search,
  onImport,
  onResume,
  onSearch,
}: LibraryTopBarProps) {
  const { t } = useTranslation();
  return (
    <header className="library-topbar glass">
      {search === null ? (
        <>
          <h1 id="library-title">{title}</h1>
          <span className="library-topbar-spacer" />
          <button
            type="button"
            className="glass-button"
            aria-label={t("librarySearch.open")}
            title={t("librarySearch.open")}
            onClick={onSearch}
          >
            <MagnifyingGlassIcon size={17} aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <h1 id="library-title" className="visually-hidden">
            {title}
          </h1>
          {search}
        </>
      )}
      {resumeTitle !== null && (
        <button
          type="button"
          className="glass-button library-resume"
          aria-label={t("app.resumeReading", { title: resumeTitle })}
          onClick={onResume}
        >
          <BookOpenTextIcon size={17} aria-hidden="true" />
          <span>
            <small>{t("app.read")}</small>
            <strong>{resumeTitle}</strong>
          </span>
        </button>
      )}
      <button type="button" className="solid-button" onClick={onImport} disabled={opening}>
        <PlusIcon size={13} weight="bold" aria-hidden="true" />
        {opening ? t("app.choosingPdf") : t("app.addPdf")}
      </button>
    </header>
  );
}
