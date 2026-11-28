import { useLayoutEffect, useRef, type ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ToolButton } from "../../../shared/components/ToolButton";
import { useSliderHover } from "./useSliderHover";

const viewportMargin = 8;

type TurnButton = { label: string; disabled: boolean; onClick: () => void };

export type SliderMarker = {
  key: string | number;
  position: number;
  current: boolean;
  label: string;
  tooltip: string;
  onGo: () => void;
};

export type SliderSeek = {
  min: number;
  max: number;
  onSeek: (value: number) => void;
  renderHover: (value: number) => ReactNode;
};

type ReaderBottomBarProps = {
  left: TurnButton;
  right: TurnButton;
  counter: ReactNode;
  rtl: boolean;
  slider: ReactNode;
  markers: SliderMarker[];
  seek: SliderSeek;
};

export function ReaderBottomBar({
  left,
  right,
  counter,
  rtl,
  slider,
  markers,
  seek,
}: ReaderBottomBarProps) {
  const { t } = useTranslation();
  const hover = useSliderHover({ min: seek.min, max: seek.max, rtl, onSeek: seek.onSeek });
  const hoverPosition =
    hover.value === null || seek.max <= seek.min
      ? 0
      : ((hover.value - seek.min) / (seek.max - seek.min)) * 100;
  const hoverCardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const card = hoverCardRef.current;
    if (!card) {
      return;
    }
    card.style.setProperty("--hover-shift", "0px");
    const rect = card.getBoundingClientRect();
    const overflowRight = rect.right - (window.innerWidth - viewportMargin);
    const overflowLeft = viewportMargin - rect.left;
    const shift = overflowRight > 0 ? -overflowRight : Math.max(0, overflowLeft);
    card.style.setProperty("--hover-shift", `${shift}px`);
  });

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
        <div className={`reader-page-rail${rtl ? " is-rtl" : ""}`} {...hover.handlers}>
          {slider}
          {hover.value !== null && (
            <div className="reader-slider-hover" aria-hidden="true">
              <div
                ref={hoverCardRef}
                className="reader-slider-hover-card glass glass-strong"
                style={{ "--hover-position": `${hoverPosition}%` }}
              >
                {seek.renderHover(hover.value)}
              </div>
            </div>
          )}
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
