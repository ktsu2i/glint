import { describe, expect, it } from "vitest";
import { sliderValueAt } from "./useSliderHover";

const rect = { left: 100, width: 218 };
const thumb = 18;

describe("sliderValueAt", () => {
  it("maps the thumb center travel onto the value range", () => {
    const range = { min: 1, max: 11, rtl: false };
    expect(sliderValueAt(rect, 109, thumb, range)).toBe(1);
    expect(sliderValueAt(rect, 209, thumb, range)).toBe(6);
    expect(sliderValueAt(rect, 309, thumb, range)).toBe(11);
  });

  it("clamps positions beyond either end", () => {
    const range = { min: 1, max: 11, rtl: false };
    expect(sliderValueAt(rect, 0, thumb, range)).toBe(1);
    expect(sliderValueAt(rect, 1000, thumb, range)).toBe(11);
  });

  it("rounds to the nearest step", () => {
    const range = { min: 1, max: 11, rtl: false };
    expect(sliderValueAt(rect, 109 + 9, thumb, range)).toBe(1);
    expect(sliderValueAt(rect, 109 + 11, thumb, range)).toBe(2);
  });

  it("reverses the direction for right-to-left books", () => {
    const range = { min: 1, max: 11, rtl: true };
    expect(sliderValueAt(rect, 109, thumb, range)).toBe(11);
    expect(sliderValueAt(rect, 309, thumb, range)).toBe(1);
  });

  it("returns the minimum when the rail has no room", () => {
    expect(sliderValueAt({ left: 0, width: 10 }, 5, thumb, { min: 1, max: 5, rtl: false })).toBe(1);
  });
});
