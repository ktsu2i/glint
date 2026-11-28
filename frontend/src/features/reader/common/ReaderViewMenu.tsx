import type { ReactNode } from "react";
import { BookOpenIcon, FileIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export function ReaderViewMenu({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div
      className="reader-view-menu glass glass-strong"
      role="dialog"
      aria-label={t("reader.view")}
    >
      {children}
    </div>
  );
}

type Layout = "single" | "spread";

export function LayoutSection({
  layout,
  note,
  onChange,
}: {
  layout: Layout;
  note?: string;
  onChange: (layout: Layout) => void;
}) {
  const { t } = useTranslation();
  return (
    <section>
      <h2>{t("reader.layoutHeading")}</h2>
      <div className="segmented" role="group" aria-label={t("reader.layoutHeading")}>
        <button type="button" aria-pressed={layout === "single"} onClick={() => onChange("single")}>
          <FileIcon size={14} aria-hidden="true" />
          {t("reader.layoutSingle")}
        </button>
        <button type="button" aria-pressed={layout === "spread"} onClick={() => onChange("spread")}>
          <BookOpenIcon size={14} aria-hidden="true" />
          {t("reader.layoutSpread")}
        </button>
      </div>
      {note !== undefined && <p>{note}</p>}
    </section>
  );
}

type StepButton = { label: string; disabled?: boolean; onClick: () => void };

export function ScaleSection({
  heading,
  value,
  decrease,
  increase,
  reset,
}: {
  heading: string;
  value: string;
  decrease: StepButton;
  increase: StepButton;
  reset: { label: string; icon?: ReactNode; pressed: boolean; onClick: () => void };
}) {
  return (
    <section>
      <h2>{heading}</h2>
      <div className="reader-zoom-row">
        <div className="reader-zoom-stepper">
          <button
            type="button"
            className="glass-button"
            aria-label={decrease.label}
            disabled={decrease.disabled}
            onClick={decrease.onClick}
          >
            <MinusIcon size={13} weight="bold" aria-hidden="true" />
          </button>
          <span>{value}</span>
          <button
            type="button"
            className="glass-button"
            aria-label={increase.label}
            disabled={increase.disabled}
            onClick={increase.onClick}
          >
            <PlusIcon size={13} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="reader-fit-button"
          aria-pressed={reset.pressed}
          onClick={reset.onClick}
        >
          {reset.icon}
          {reset.label}
        </button>
      </div>
    </section>
  );
}
