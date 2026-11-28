import { describe, expect, it } from "vitest";
import { sectionIndexAt } from "./sectionAt";

describe("sectionIndexAt", () => {
  const fractions = [0, 0.25, 0.25, 0.75, 1];

  it("finds the section that holds the fraction", () => {
    expect(sectionIndexAt(fractions, 0)).toBe(0);
    expect(sectionIndexAt(fractions, 0.1)).toBe(0);
    expect(sectionIndexAt(fractions, 0.5)).toBe(2);
    expect(sectionIndexAt(fractions, 0.9)).toBe(3);
  });

  it("skips empty sections", () => {
    expect(sectionIndexAt(fractions, 0.25)).toBe(2);
  });

  it("returns the last section at the end", () => {
    expect(sectionIndexAt(fractions, 1)).toBe(3);
  });

  it("returns null without sections", () => {
    expect(sectionIndexAt([], 0.5)).toBeNull();
    expect(sectionIndexAt([0], 0.5)).toBeNull();
  });
});
