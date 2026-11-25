import type { ReactElement } from "react";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { LibrarySortOrder } from "./librarySort";
import { LibrarySortMenu } from "./LibrarySortMenu";

type LibraryTopBarProps = {
  title: string;
  opening: boolean;
  search: ReactElement | null;
  sortOrder: LibrarySortOrder;
  onImport: () => void;
  onSearch: () => void;
  onSortOrderChange: (order: LibrarySortOrder) => void;
};

// LibraryTopBar is the floating glass bar of the library. The shelf speaks for
// itself, so the title is only for assistive technology. While searching, the
// search and sort buttons give way to the search field.
export function LibraryTopBar({
  title,
  opening,
  search,
  sortOrder,
  onImport,
  onSearch,
  onSortOrderChange,
}: LibraryTopBarProps) {
  const { t } = useTranslation();
  return (
    <header className="library-topbar glass">
      <h1 id="library-title" className="visually-hidden">
        {title}
      </h1>
      {search ?? (
        <>
          <span className="library-topbar-spacer" />
          <LibrarySortMenu order={sortOrder} onOrderChange={onSortOrderChange} />
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
        {opening ? t("app.choosingBook") : t("app.addBook")}
      </button>
    </header>
  );
}
