import { TrashIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { HighlightColor } from "../api";

const highlightColors: HighlightColor[] = ["yellow", "green", "pink", "purple"];

export type FloatingAnchor = { x: number; top: number; bottom: number; width: number };

export function floatingStyle(anchor: FloatingAnchor) {
  const x = anchor.width > 0 ? Math.min(anchor.width - 110, Math.max(110, anchor.x)) : anchor.x;
  return anchor.top < 110
    ? { left: `${x}px`, top: `${anchor.bottom + 10}px` }
    : { left: `${x}px`, top: `${anchor.top - 10}px`, transform: "translate(-50%, -100%)" };
}

type ToolbarStyle = ReturnType<typeof floatingStyle>;

export function SelectionHighlightToolbar({
  style,
  busy,
  onPick,
}: {
  style: ToolbarStyle;
  busy: boolean;
  onPick: (color: HighlightColor) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="reader-highlight-toolbar glass glass-strong"
      role="toolbar"
      aria-label={t("reader.highlightSelection")}
      tabIndex={-1}
      style={style}
      // Keep the selection while a color is picked.
      onMouseDown={(event) => event.preventDefault()}
    >
      {highlightColors.map((color) => (
        <button
          key={color}
          type="button"
          className={`reader-highlight-swatch is-${color}`}
          aria-label={t("reader.highlightIn", { color: t(`reader.color.${color}`) })}
          disabled={busy}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

export function HighlightActionsToolbar({
  style,
  color: current,
  busy,
  onRecolor,
  onRemove,
}: {
  style: ToolbarStyle;
  color: HighlightColor;
  busy: boolean;
  onRecolor: (color: HighlightColor) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="reader-highlight-toolbar glass glass-strong"
      role="toolbar"
      aria-label={t("reader.highlightActions")}
      style={style}
    >
      {highlightColors.map((color) => (
        <button
          key={color}
          type="button"
          className={`reader-highlight-swatch is-${color}`}
          aria-label={t("reader.changeHighlightColor", { color: t(`reader.color.${color}`) })}
          aria-pressed={current === color}
          disabled={busy}
          onClick={() => {
            if (current !== color) {
              onRecolor(color);
            }
          }}
        />
      ))}
      <span className="reader-highlight-divider" aria-hidden="true" />
      <button
        type="button"
        className="reader-highlight-remove"
        aria-label={t("reader.removeHighlight")}
        title={t("reader.removeHighlight")}
        disabled={busy}
        onClick={onRemove}
      >
        <TrashIcon size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
