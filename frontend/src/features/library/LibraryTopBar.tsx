import type { ReactElement } from "react";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

type LibraryTopBarProps = {
  title: string;
  opening: boolean;
  search: ReactElement | null;
  onImport: () => void;
  onSearch: () => void;
};

// LibraryTopBar is the floating glass bar of the library. The shelf speaks for
// itself, so the title is only for assistive technology. While searching, the
// search button gives way to the search field.
export function LibraryTopBar({ title, opening, search, onImport, onSearch }: LibraryTopBarProps) {
  const { t } = useTranslation();
  return (
    <header className="library-topbar glass">
      <h1 id="library-title" className="visually-hidden">
        {title}
      </h1>
      {search ?? (
        <>
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
      )}
      <button type="button" className="solid-button" onClick={onImport} disabled={opening}>
        <PlusIcon size={13} weight="bold" aria-hidden="true" />
        {opening ? t("app.choosingPdf") : t("app.addPdf")}
      </button>
    </header>
  );
}
