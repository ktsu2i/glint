import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sectionIndexAt } from "./sectionAt";

// Section start fractions as foliate-js reports them: from 0 to 1, never decreasing, and equal
// neighbours for empty sections.
const fractionsArbitrary = fc
  .array(fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(0, 0.5, 1)), {
    minLength: 1,
    maxLength: 12,
  })
  .map((starts) => [0, ...starts.toSorted((a, b) => a - b), 1]);

const fractionArbitrary = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.constantFrom(0, 0.5, 1),
);

describe("sectionIndexAt properties", () => {
  it("returns a section of the book", () => {
    fc.assert(
      fc.property(fractionsArbitrary, fractionArbitrary, (fractions, fraction) => {
        const index = sectionIndexAt(fractions, fraction);
        expect(index).not.toBeNull();
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(fractions.length - 1);
      }),
    );
  });

  it("never moves backwards as the fraction grows", () => {
    fc.assert(
      fc.property(fractionsArbitrary, fractionArbitrary, fractionArbitrary, (fractions, a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(sectionIndexAt(fractions, low)).toBeLessThanOrEqual(
          sectionIndexAt(fractions, high) ?? -1,
        );
      }),
    );
  });

  it("lands on the section that holds the fraction", () => {
    fc.assert(
      fc.property(fractionsArbitrary, fractionArbitrary, (fractions, fraction) => {
        fc.pre(fraction < 1);
        const index = sectionIndexAt(fractions, fraction) ?? -1;
        expect(fractions[index]).toBeLessThanOrEqual(fraction);
        expect(fractions[index + 1]).toBeGreaterThan(fraction);
      }),
    );
  });
});
