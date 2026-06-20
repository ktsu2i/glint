import { fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "@base-ui/react/tooltip";
import { describe, expect, it, vi } from "vitest";
import { ToolButton } from "./ToolButton";

describe("ToolButton", () => {
  it("renders an enabled button with optional styling and handles clicks", () => {
    const onClick = vi.fn();
    render(
      <Tooltip.Provider>
        <ToolButton label="拡大" className="is-active" onClick={onClick}>
          +
        </ToolButton>
      </Tooltip.Provider>,
    );

    const button = screen.getByRole("button", { name: "拡大" });
    expect(button.className).toBe("tool-button is-active");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies default props and prevents disabled clicks", () => {
    const onClick = vi.fn();
    render(
      <Tooltip.Provider>
        <ToolButton label="縮小" disabled onClick={onClick}>
          −
        </ToolButton>
      </Tooltip.Provider>,
    );

    const button = screen.getByRole("button", { name: "縮小" });
    expect(button.className).toBe("tool-button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
