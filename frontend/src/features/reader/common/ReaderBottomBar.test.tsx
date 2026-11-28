import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../shared/i18n/i18n";
import { ReaderBottomBar } from "./ReaderBottomBar";

const turn = { label: "turn", disabled: false, onClick: vi.fn() };

function renderBar(onSeek: (value: number) => void) {
  render(
    <I18nProvider initialLanguage="en">
      <ReaderBottomBar
        left={turn}
        right={turn}
        counter={null}
        rtl={false}
        slider={<input type="range" min={1} max={11} defaultValue={1} aria-label="slider" />}
        markers={[]}
        seek={{ min: 1, max: 11, onSeek, renderHover: (value) => `page ${value}` }}
      />
    </I18nProvider>,
  );
  const slider = screen.getByLabelText("slider");
  const rail = slider.parentElement;
  if (!rail) {
    throw new Error("rail not found");
  }
  // 218px wide with an 18px thumb leaves 20px per page.
  vi.spyOn(rail, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 218, 30));
  return slider;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReaderBottomBar slider hover", () => {
  it("shows the page under the pointer and seeks to it on click", () => {
    const onSeek = vi.fn();
    const slider = renderBar(onSeek);

    fireEvent.pointerMove(slider, { clientX: 209 });
    expect(screen.queryByText("page 6")).not.toBeNull();

    fireEvent.pointerDown(slider, { clientX: 209, clientY: 10 });
    fireEvent.pointerUp(slider, { clientX: 209, clientY: 10 });
    expect(onSeek).toHaveBeenCalledWith(6);
  });

  it("does not seek after a drag", () => {
    const onSeek = vi.fn();
    const slider = renderBar(onSeek);

    fireEvent.pointerDown(slider, { clientX: 109, clientY: 10 });
    fireEvent.pointerUp(slider, { clientX: 209, clientY: 10 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("hides the hover card when the pointer leaves", () => {
    const slider = renderBar(vi.fn());

    fireEvent.pointerMove(slider, { clientX: 209 });
    fireEvent.pointerLeave(slider.parentElement as HTMLElement);
    expect(screen.queryByText("page 6")).toBeNull();
  });
});
