import { afterEach, describe, expect, it } from "vitest";
import {
  joinSelectedText,
  mergeLineRects,
  rectContainsPoint,
  selectionToPageSelections,
} from "./highlights";

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

// Builds a page like the reader's: a .pdf-page holding a text layer of spans.
function makePage(pageNumber: number, lines: string[][], box: DOMRect): HTMLElement {
  const page = document.createElement("div");
  page.className = "pdf-page";
  page.dataset.page = String(pageNumber);
  page.getBoundingClientRect = () => box;
  const layer = document.createElement("div");
  layer.className = "text-layer";
  for (const line of lines) {
    for (const run of line) {
      const span = document.createElement("span");
      span.textContent = run;
      layer.append(span);
    }
    layer.append(document.createElement("br"));
  }
  page.append(layer);
  document.body.append(page);
  return page;
}

// jsdom has no layout or Range.getClientRects, so each text node reports a box
// from a lookup table.
function stubTextRects(boxes: Map<string, DOMRect>) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value(this: Range) {
      const box = boxes.get(this.startContainer.textContent ?? "");
      return box ? [box] : [];
    },
  });
}

function textOf(page: HTMLElement, index: number): Text {
  return page.querySelectorAll("span")[index]!.firstChild as Text;
}

afterEach(() => {
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  document.body.replaceChildren();
});

describe("selectionToPageSelections", () => {
  it("returns the selected text and page-relative rectangles", () => {
    const page = makePage(
      3,
      [["Interfaces belong ", "to the consumer"], ["that uses them."]],
      domRect(100, 50, 200, 400),
    );
    stubTextRects(
      new Map([
        ["Interfaces belong ", domRect(120, 90, 80, 10)],
        ["to the consumer", domRect(200, 90, 60, 10)],
        ["that uses them.", domRect(120, 102, 50, 10)],
      ]),
    );
    const range = document.createRange();
    range.setStart(textOf(page, 0), 11);
    range.setEnd(textOf(page, 2), 4);

    const [selection, ...rest] = selectionToPageSelections(range, [page]);

    expect(rest).toEqual([]);
    expect(selection?.pageNumber).toBe(3);
    expect(selection?.text).toBe("belong to the consumer that");
    expect(selection?.rects).toHaveLength(2);
    expect(selection?.rects[0]).toMatchObject({ x: 0.1, y: 0.1 });
    expect(selection?.rects[0]?.width).toBeCloseTo(0.7);
    expect(selection?.rects[0]?.height).toBeCloseTo(0.025);
    expect(selection?.rects[1]?.x).toBeCloseTo(0.1);
    expect(selection?.rects[1]?.width).toBeCloseTo(0.25);
    expect(selection?.rects[1]?.y).toBeCloseTo(0.13);
  });

  it("splits a selection across a spread into one entry per page", () => {
    const left = makePage(4, [["left page text"]], domRect(0, 0, 100, 100));
    const right = makePage(5, [["right page text"]], domRect(100, 0, 100, 100));
    stubTextRects(
      new Map([
        ["left page text", domRect(10, 10, 50, 5)],
        ["right page text", domRect(110, 10, 50, 5)],
      ]),
    );
    const range = document.createRange();
    range.setStart(textOf(left, 0), 5);
    range.setEnd(textOf(right, 0), 5);

    const selections = selectionToPageSelections(range, [left, right]);

    expect(selections.map(({ pageNumber, text }) => ({ pageNumber, text }))).toEqual([
      { pageNumber: 4, text: "page text" },
      { pageNumber: 5, text: "right" },
    ]);
  });

  it("ignores pages without a rendered page number or outside the selection", () => {
    const pending = makePage(1, [["not ready"]], domRect(0, 0, 100, 100));
    delete pending.dataset.page;
    const other = makePage(2, [["elsewhere"]], domRect(0, 0, 100, 100));
    const selected = makePage(3, [["chosen"]], domRect(0, 0, 100, 100));
    stubTextRects(new Map([["chosen", domRect(10, 10, 20, 5)]]));
    const range = document.createRange();
    range.selectNodeContents(textOf(selected, 0));

    expect(
      selectionToPageSelections(range, [pending, other, selected]).map((s) => s.pageNumber),
    ).toEqual([3]);
  });
});

describe("joinSelectedText", () => {
  it("joins English lines with a space and Japanese lines without one", () => {
    expect(joinSelectedText(["Retrieval ", "\n", "  stays local"])).toBe("Retrieval stays local");
    expect(joinSelectedText(["依存の向きは", "\n", "一方向に保つ"])).toBe(
      "依存の向きは一方向に保つ",
    );
    expect(joinSelectedText(["\n", " edge ", "\n"])).toBe("edge");
  });
});

describe("mergeLineRects", () => {
  it("merges runs on the same line and keeps separate lines apart", () => {
    const merged = mergeLineRects([
      { x: 0.5, y: 0.1, width: 0.2, height: 0.02 },
      { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
      { x: 0.1, y: 0.101, width: 0.39, height: 0.02 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ x: 0.1, y: 0.1 });
    expect(merged[0]?.width).toBeCloseTo(0.6);
    expect(merged[1]).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.02 });
  });
});

describe("rectContainsPoint", () => {
  it("includes the edges", () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 };
    expect(rectContainsPoint(rect, 0.1, 0.2)).toBe(true);
    expect(rectContainsPoint(rect, 0.31, 0.15)).toBe(false);
  });
});
