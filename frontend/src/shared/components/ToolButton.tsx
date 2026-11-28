import type { ReactNode } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import "./ToolButton.css";

type ToolButtonProps = {
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  expanded?: boolean;
  onClick?: () => void;
};

export function ToolButton({
  label,
  children,
  className = "",
  disabled = false,
  expanded,
  onClick,
}: ToolButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        className={`tool-button ${className}`.trim()}
        disabled={disabled}
        aria-expanded={expanded}
        render={<button type="button" aria-label={label} disabled={disabled} onClick={onClick} />}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={7}>
          <Tooltip.Popup className="tooltip-popup">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
