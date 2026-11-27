import type { HighlightColor, HighlightRect } from "./api";

export const highlightColors: HighlightColor[] = ["yellow", "green", "pink", "purple"];

export type PageSelection = {
  pageNumber: number;
  text: string;
  rects: HighlightRect[];
};

type Box = { left: number; top: number; right: number; bottom: number };

// Rectangles smaller than this, in fractions of the page, are layout noise.
const minimumRectSize = 0.001;
const cjkPattern = /[　-ヿ㐀-鿿豈-﫿＀-￯]/u;

/**
 * Splits a selection into one entry per page it covers. Each entry carries the
 * selected text and its rectangles in fractions of the page, so the highlight
 * can be drawn again at any zoom. Only text nodes count, which keeps the
 * text layer's helper elements out of the rectangles.
 */
export function selectionToPageSelections(range: Range, pages: HTMLElement[]): PageSelection[] {
  const selections: PageSelection[] = [];
  for (const page of pages) {
    const pageNumber = Number(page.dataset.page);
    const layer = page.querySelector<HTMLElement>(".text-layer");
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || !layer || !range.intersectsNode(layer)) {
      continue;
    }
    const pageBox = page.getBoundingClientRect();
    if (pageBox.width <= 0 || pageBox.height <= 0) {
      continue;
    }
    const pieces: string[] = [];
    const boxes: Box[] = [];
    const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let previousParent: Node | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) {
        continue;
      }
      const length = node.textContent?.length ?? 0;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : length;
      if (end <= start) {
        continue;
      }
      // pdf.js puts each text run in its own span; a new span starts a new run.
      if (previousParent && previousParent !== node.parentNode) {
        pieces.push(isLineBreakBetween(previousParent, node.parentNode) ? "\n" : "");
      }
      previousParent = node.parentNode;
      pieces.push((node.textContent ?? "").slice(start, end));
      const nodeRange = layer.ownerDocument.createRange();
      nodeRange.setStart(node, start);
      nodeRange.setEnd(node, end);
      for (const rect of nodeRange.getClientRects()) {
        boxes.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      }
    }
    const text = joinSelectedText(pieces);
    const rects = mergeLineRects(
      boxes
        .map((box) => toPageRect(box, pageBox))
        .filter((rect): rect is HighlightRect => rect !== null),
    );
    if (text !== "" && rects.length > 0) {
      selections.push({ pageNumber, text, rects });
    }
  }
  return selections;
}

function isLineBreakBetween(previous: Node, next: Node | null): boolean {
  for (
    let sibling = previous.nextSibling;
    sibling && sibling !== next;
    sibling = sibling.nextSibling
  ) {
    if (sibling.nodeName === "BR") {
      return true;
    }
  }
  return false;
}

/** Joins the selected runs, dropping line breaks between CJK characters. */
export function joinSelectedText(pieces: string[]): string {
  return pieces
    .join("")
    .replaceAll(/[ \t]*\n[ \t]*/g, "\n")
    .replaceAll(/(.)\n(?=(.))/gu, (_, before: string, after: string) =>
      cjkPattern.test(before) && cjkPattern.test(after) ? before : `${before} `,
    )
    .replaceAll("\n", " ")
    .replaceAll(/\s{2,}/g, " ")
    .trim();
}

function toPageRect(box: Box, page: DOMRect): HighlightRect | null {
  const left = clamp((box.left - page.left) / page.width);
  const right = clamp((box.right - page.left) / page.width);
  const top = clamp((box.top - page.top) / page.height);
  const bottom = clamp((box.bottom - page.top) / page.height);
  if (right - left < minimumRectSize || bottom - top < minimumRectSize) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Merges the rectangles of runs on the same line, so overlapping runs do not
 * draw darker patches and a long selection stays a handful of rectangles.
 */
export function mergeLineRects(rects: HighlightRect[]): HighlightRect[] {
  const sorted = rects.toSorted((a, b) => a.y - b.y || a.x - b.x);
  const merged: HighlightRect[] = [];
  for (const rect of sorted) {
    const line = merged.find((candidate) => sameLine(candidate, rect));
    if (!line) {
      merged.push({ ...rect });
      continue;
    }
    const left = Math.min(line.x, rect.x);
    const top = Math.min(line.y, rect.y);
    const right = Math.max(line.x + line.width, rect.x + rect.width);
    const bottom = Math.max(line.y + line.height, rect.y + rect.height);
    Object.assign(line, { x: left, y: top, width: right - left, height: bottom - top });
  }
  return merged;
}

function sameLine(a: HighlightRect, b: HighlightRect): boolean {
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (overlap < Math.min(a.height, b.height) * 0.5) {
    return false;
  }
  const gap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  return gap <= Math.max(a.height, b.height);
}

export function rectContainsPoint(rect: HighlightRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}
