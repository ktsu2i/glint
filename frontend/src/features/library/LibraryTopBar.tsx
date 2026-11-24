import {
  BookOpenTextIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

type LibraryTopBarProps = {
  title: string;
  resumeTitle: string | null;
  opening: boolean;
  searchActive: boolean;
  settingsActive: boolean;
  onImport: () => void;
  onResume: () => void;
  onSearch: () => void;
  onSettings: () => void;
};

export function LibraryTopBar({
  title,
  resumeTitle,
  opening,
  searchActive,
  settingsActive,
  onImport,
  onResume,
  onSearch,
  onSettings,
}: LibraryTopBarProps) {
  const { t } = useTranslation();
  return (
    <header className="library-topbar glass">
      <h1 id="library-title">{title}</h1>
      <span className="library-topbar-spacer" />
      <button
        type="button"
        className="glass-button"
        aria-label={t("app.search")}
        aria-pressed={searchActive}
        onClick={onSearch}
      >
        <MagnifyingGlassIcon size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="glass-button"
        aria-label={t("app.settings")}
        aria-pressed={settingsActive}
        onClick={onSettings}
      >
        <GearSixIcon size={17} aria-hidden="true" />
      </button>
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
