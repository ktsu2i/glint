import type { ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ToolButton } from "../../../shared/components/ToolButton";

type TurnButton = { label: string; disabled: boolean; onClick: () => void };

export type SliderMarker = {
  key: string | number;
  position: number;
  current: boolean;
  label: string;
  tooltip: string;
  onGo: () => void;
};

type ReaderBottomBarProps = {
  left: TurnButton;
  right: TurnButton;
  counter: ReactNode;
  rtl: boolean;
  slider: ReactNode;
  markers: SliderMarker[];
};

export function ReaderBottomBar({
  left,
  right,
  counter,
  rtl,
  slider,
  markers,
}: ReaderBottomBarProps) {
  const { t } = useTranslation();
  return (
    <footer className="reader-bottombar glass" aria-label={t("reader.pageControls")}>
      <ToolButton label={left.label} disabled={left.disabled} onClick={left.onClick}>
        <CaretLeftIcon size={16} weight="bold" />
      </ToolButton>
      {counter}
      <ToolButton label={right.label} disabled={right.disabled} onClick={right.onClick}>
        <CaretRightIcon size={16} weight="bold" />
      </ToolButton>
      <div className="reader-page-slider">
        <div className={`reader-page-rail${rtl ? " is-rtl" : ""}`}>
          {slider}
          <div className="reader-slider-bookmarks">
            {markers.map((marker) => (
              <button
                key={marker.key}
                type="button"
                className={`reader-slider-bookmark${marker.current ? " is-current" : ""}`}
                style={{ "--bookmark-position": `${marker.position}%` }}
                aria-label={marker.label}
                aria-current={marker.current ? "page" : undefined}
                data-tooltip={marker.tooltip}
                onClick={marker.onGo}
              >
                <span className="reader-slider-bookmark-dot" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
