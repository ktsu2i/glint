import * as fc from "fast-check";
import { compare as compareCFI } from "foliate-js/epubcfi.js";
import { describe, expect, it } from "vitest";
import type { EpubBookmark, EpubHighlight } from "../api";
import { isCFIOnPage, pageStartCFI, sortEpubBookmarks, sortEpubHighlights } from "./epubContent";

const stepsArbitrary = fc.array(
  fc.integer({ min: 1, max: 6 }).map((n) => n * 2),
  {
    minLength: 1,
    maxLength: 3,
  },
);

// A point in a spine item: element steps, then optionally a text node with a character offset.
const localPathArbitrary = fc
  .tuple(stepsArbitrary, fc.option(fc.nat({ max: 40 }), { nil: undefined }))
  .map(
    ([steps, offset]) =>
      steps.map((step) => `/${step}`).join("") + (offset === undefined ? "" : `/1:${offset}`),
  );

const cfiArbitrary = fc
  .tuple(fc.integer({ min: 1, max: 4 }), localPathArbitrary)
  .map(([spine, path]) => `epubcfi(/6/${spine * 2}!${path})`);

const bookmarkArbitrary: fc.Arbitrary<EpubBookmark> = fc.record({
  location: fc.record({
    kind: fc.constant("epub" as const),
    section: fc.integer({ min: 1, max: 3 }),
    cfi: cfiArbitrary,
    progress: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  createdAt: fc.constant(""),
});

const highlightArbitrary = (id: number): fc.Arbitrary<EpubHighlight> =>
  fc.record({
    id: fc.constant(id),
    color: fc.constant("yellow" as const),
    text: fc.constant("text"),
    location: fc.record({
      kind: fc.constant("epub" as const),
      section: fc.integer({ min: 1, max: 3 }),
      cfi: fc.oneof(cfiArbitrary, fc.constantFrom("", "epubcfi(", "not a cfi")),
    }),
    createdAt: fc.constant(""),
  });

const highlightsArbitrary = fc
  .integer({ min: 0, max: 20 })
  .chain((count) => fc.tuple(...Array.from({ length: count }, (_, id) => highlightArbitrary(id))));

describe("sortEpubBookmarks properties", () => {
  it("orders bookmarks by section, then by place in the section", () => {
    fc.assert(
      fc.property(fc.array(bookmarkArbitrary, { maxLength: 20 }), (bookmarks) => {
        const sorted = sortEpubBookmarks(bookmarks);
        expect(sorted.toSorted(byJSON)).toEqual(bookmarks.toSorted(byJSON));
        for (const [previous, following] of neighbours(sorted)) {
          const inOrder =
            previous.location.section < following.location.section ||
            (previous.location.section === following.location.section &&
              compareCFI(previous.location.cfi, following.location.cfi) <= 0);
          expect(inOrder).toBe(true);
        }
        expect(sortEpubBookmarks(sorted)).toEqual(sorted);
      }),
    );
  });
});

describe("sortEpubHighlights properties", () => {
  it("keeps every highlight and gives the same order whatever order they arrive in", () => {
    fc.assert(
      fc.property(
        highlightsArbitrary.chain((highlights) =>
          fc.tuple(
            fc.constant(highlights),
            fc.shuffledSubarray(highlights, { minLength: highlights.length }),
          ),
        ),
        ([highlights, shuffled]) => {
          const sorted = sortEpubHighlights(highlights);
          expect(sorted.map((highlight) => highlight.id).toSorted((a, b) => a - b)).toEqual(
            highlights.map((highlight) => highlight.id),
          );
          for (const [previous, following] of neighbours(sorted)) {
            expect(previous.location.section).toBeLessThanOrEqual(following.location.section);
          }
          expect(sortEpubHighlights(shuffled).map((highlight) => highlight.id)).toEqual(
            sorted.map((highlight) => highlight.id),
          );
        },
      ),
    );
  });
});

describe("isCFIOnPage properties", () => {
  it("puts a page's start on the page and its end after it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        stepsArbitrary,
        fc.nat({ max: 40 }),
        fc.nat({ max: 40 }),
        (spine, steps, a, b) => {
          fc.pre(a !== b);
          const parent = `/6/${spine * 2}!${steps.map((step) => `/${step}`).join("")}`;
          const page = `epubcfi(${parent},/1:${Math.min(a, b)},/1:${Math.max(a, b)})`;
          const start = pageStartCFI(page);
          const end = `epubcfi(${parent}/1:${Math.max(a, b)})`;
          expect(isCFIOnPage(start, page)).toBe(true);
          expect(isCFIOnPage(end, page)).toBe(false);
        },
      ),
    );
  });
});

function byJSON(a: unknown, b: unknown): number {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function neighbours<T>(items: T[]): [T, T][] {
  return items.slice(1).map((item, i) => [items[i]!, item]);
}
