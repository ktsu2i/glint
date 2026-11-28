import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { HighlightRect } from "../api";
import { joinSelectedText, mergeLineRects } from "./highlights";

const epsilon = 1e-9;

const rectArbitrary: fc.Arbitrary<HighlightRect> = fc
  .record({
    x: fc.double({ min: 0, max: 0.99, noNaN: true }),
    y: fc.double({ min: 0, max: 0.99, noNaN: true }),
    width: fc.double({ min: 0.001, max: 1, noNaN: true }),
    height: fc.double({ min: 0.001, max: 1, noNaN: true }),
  })
  .map(({ x, y, width, height }) => ({
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  }));

function contains(outer: HighlightRect, inner: HighlightRect): boolean {
  return (
    outer.x <= inner.x + epsilon &&
    outer.y <= inner.y + epsilon &&
    outer.x + outer.width + epsilon >= inner.x + inner.width &&
    outer.y + outer.height + epsilon >= inner.y + inner.height
  );
}

function bounds(rects: HighlightRect[]) {
  return {
    left: Math.min(...rects.map((rect) => rect.x)),
    top: Math.min(...rects.map((rect) => rect.y)),
    right: Math.max(...rects.map((rect) => rect.x + rect.width)),
    bottom: Math.max(...rects.map((rect) => rect.y + rect.height)),
  };
}

describe("mergeLineRects properties", () => {
  it("covers every input rect with no more rects than it was given", () => {
    fc.assert(
      fc.property(fc.array(rectArbitrary, { maxLength: 30 }), (rects) => {
        const merged = mergeLineRects(rects);
        expect(merged.length).toBeLessThanOrEqual(rects.length);
        for (const rect of rects) {
          expect(merged.some((line) => contains(line, rect))).toBe(true);
        }
      }),
    );
  });

  it("keeps the selection's bounds and stays on the page", () => {
    fc.assert(
      fc.property(fc.array(rectArbitrary, { minLength: 1, maxLength: 30 }), (rects) => {
        const merged = mergeLineRects(rects);
        const before = bounds(rects);
        const after = bounds(merged);
        expect(after.left).toBeCloseTo(before.left, 9);
        expect(after.top).toBeCloseTo(before.top, 9);
        expect(after.right).toBeCloseTo(before.right, 9);
        expect(after.bottom).toBeCloseTo(before.bottom, 9);
        for (const rect of merged) {
          expect(rect.width).toBeGreaterThan(0);
          expect(rect.height).toBeGreaterThan(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(1 + epsilon);
          expect(rect.y + rect.height).toBeLessThanOrEqual(1 + epsilon);
        }
      }),
    );
  });

  it("does not change its input", () => {
    fc.assert(
      fc.property(fc.array(rectArbitrary, { maxLength: 30 }), (rects) => {
        const copy = structuredClone(rects);
        mergeLineRects(rects);
        expect(rects).toEqual(copy);
      }),
    );
  });
});

const pieceArbitrary = fc.string({
  unit: fc.constantFrom("a", "B", " ", "\t", "\n", "あ", "漢", "。", "　", "-"),
  maxLength: 12,
});

describe("joinSelectedText properties", () => {
  it("returns one trimmed line with single spaces", () => {
    fc.assert(
      fc.property(fc.array(pieceArbitrary, { maxLength: 8 }), (pieces) => {
        const text = joinSelectedText(pieces);
        expect(text).not.toContain("\n");
        expect(text).not.toMatch(/\s{2,}/);
        expect(text).toBe(text.trim());
      }),
    );
  });

  it("is stable when joined again", () => {
    fc.assert(
      fc.property(fc.array(pieceArbitrary, { maxLength: 8 }), (pieces) => {
        const text = joinSelectedText(pieces);
        expect(joinSelectedText([text])).toBe(text);
      }),
    );
  });

  it("keeps every non-space character in order", () => {
    fc.assert(
      fc.property(fc.array(pieceArbitrary, { maxLength: 8 }), (pieces) => {
        expect(visible(joinSelectedText(pieces))).toBe(visible(pieces.join("")));
      }),
    );
  });
});

function visible(text: string): string {
  return text.replaceAll(/\s/g, "");
}
