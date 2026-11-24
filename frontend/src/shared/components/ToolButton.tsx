import type { ReactNode } from "react";
import { Tooltip } from "@base-ui/react/tooltip";

type ToolButtonProps = {
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
};

export function ToolButton({
  label,
  children,
  className = "",
  disabled = false,
  onClick,
}: ToolButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        className={`tool-button ${className}`.trim()}
        disabled={disabled}
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
