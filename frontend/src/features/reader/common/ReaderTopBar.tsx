import { useCallback, useState, type ReactNode } from "react";
import {
  BookmarkSimpleIcon,
  BookmarksSimpleIcon,
  CaretLeftIcon,
  HighlighterIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  SpeakerHighIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ToolButton } from "../../../shared/components/ToolButton";

export type ReaderPanel = "toc" | "search" | "bookmarks" | "highlights";

/** Which side sheet is open, if any. Toggling the open one closes it. */
export function useReaderPanel() {
  const [openPanel, setOpenPanel] = useState<ReaderPanel | null>(null);
  const togglePanel = useCallback((panel: ReaderPanel) => {
    setOpenPanel((current) => (current === panel ? null : panel));
  }, []);
  return { openPanel, setOpenPanel, togglePanel };
}

type ReaderTopBarProps = {
  /** Whether the book is loaded, which the panels and read aloud need. */
  ready: boolean;
  title: string;
  /** Shown under the title unless null. */
  subtitle: ReactNode;
  openPanel: ReaderPanel | null;
  onTogglePanel: (panel: ReaderPanel) => void;
  readAloud: { supported: boolean; active: boolean; onToggle: () => void };
  bookmark: { label: string; active: boolean; disabled: boolean; onToggle: () => void };
  viewMenu: { open: boolean; icon: ReactNode; onToggle: () => void };
  onHoverChange: (hovered: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  onBack: (() => void) | undefined;
};

export function ReaderTopBar({
  ready,
  title,
  subtitle,
  openPanel,
  onTogglePanel,
  readAloud,
  bookmark,
  viewMenu,
  onHoverChange,
  onFocusChange,
  onBack,
}: ReaderTopBarProps) {
  const { t } = useTranslation();
  const panelButtons = [
    {
      panel: "toc",
      open: t("reader.openToc"),
      close: t("reader.closeToc"),
      icon: <ListBulletsIcon size={17} weight="regular" />,
    },
    {
      panel: "search",
      open: t("reader.openSearch"),
      close: t("reader.closeSearch"),
      icon: <MagnifyingGlassIcon size={17} weight="regular" />,
    },
    {
      panel: "bookmarks",
      open: t("reader.openBookmarks"),
      close: t("reader.closeBookmarks"),
      icon: <BookmarksSimpleIcon size={17} weight="regular" />,
    },
    {
      panel: "highlights",
      open: t("reader.openHighlights"),
      close: t("reader.closeHighlights"),
      icon: <HighlighterIcon size={17} weight="regular" />,
    },
  ] as const;

  return (
    <header
      className="reader-topbar glass"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onFocusChange(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onFocusChange(false);
        }
      }}
    >
      <div className="reader-topbar-start">
        {onBack && (
          <button type="button" className="glass-button reader-back" onClick={onBack}>
            <CaretLeftIcon size={15} weight="bold" aria-hidden="true" />
            {t("reader.backToLibrary")}
          </button>
        )}
        <span className="reader-topbar-separator" aria-hidden="true" />
        {panelButtons.map(({ panel, open, close, icon }) => (
          <ToolButton
            key={panel}
            label={openPanel === panel ? close : open}
            className={openPanel === panel ? "is-active" : ""}
            onClick={() => onTogglePanel(panel)}
            disabled={!ready}
          >
            {icon}
          </ToolButton>
        ))}
      </div>
      <div className="reader-title">
        <strong title={title}>{title}</strong>
        {subtitle !== null && <span>{subtitle}</span>}
      </div>
      <div className="reader-topbar-end">
        <ToolButton
          label={
            readAloud.supported
              ? readAloud.active
                ? t("reader.stopReadAloud")
                : t("reader.startReadAloud")
              : t("reader.readAloudUnsupported")
          }
          className={readAloud.active ? "is-active is-reading" : ""}
          disabled={!ready || !readAloud.supported}
          onClick={readAloud.onToggle}
        >
          <SpeakerHighIcon size={17} weight={readAloud.active ? "fill" : "regular"} />
        </ToolButton>
        <ToolButton
          label={bookmark.label}
          className={
            bookmark.active ? "is-active reader-bookmark-toggle" : "reader-bookmark-toggle"
          }
          disabled={!ready || bookmark.disabled}
          onClick={bookmark.onToggle}
        >
          <BookmarkSimpleIcon size={17} weight={bookmark.active ? "fill" : "regular"} />
        </ToolButton>
        <ToolButton
          label={t("reader.view")}
          className={viewMenu.open ? "is-active" : ""}
          expanded={viewMenu.open}
          onClick={viewMenu.onToggle}
        >
          {viewMenu.icon}
        </ToolButton>
      </div>
    </header>
  );
}
