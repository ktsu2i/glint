import { collapse as collapseCFI, compare as compareCFI } from "foliate-js/epubcfi.js";
import type { FoliateTocItem } from "foliate-js/view.js";
import type {
  BookBookmark,
  BookHighlight,
  HighlightColor,
  ReaderSettings,
} from "../../shared/api/backend";

export const EPUB_MIN_FONT_SCALE = 80;
export const EPUB_MAX_FONT_SCALE = 200;
export const EPUB_FONT_SCALE_STEP = 10;

export type EpubTheme = "light" | "dark";

const markupTypes = new Set(["application/xhtml+xml", "text/html", "image/svg+xml"]);
const activeElements = "script, iframe, object, embed, frame, frameset, meta[http-equiv]";

/**
 * Removes what could run code from a section: script and embedding elements,
 * event handler attributes, and javascript: links. The production build also
 * blocks scripts with a Content Security Policy; this keeps them out in
 * development too, and from books that rely on neither.
 */
export function stripActiveContent(markup: string, type: string): string {
  const parser = new DOMParser();
  let documentType: DOMParserSupportedType =
    type === "text/html" ? "text/html" : "application/xhtml+xml";
  if (type === "image/svg+xml") {
    documentType = "image/svg+xml";
  }
  let doc = parser.parseFromString(markup, documentType);
  if (documentType !== "text/html" && doc.querySelector("parsererror") !== null) {
    documentType = "text/html";
    doc = parser.parseFromString(markup, documentType);
  }
  for (const element of doc.querySelectorAll(activeElements)) {
    element.remove();
  }
  for (const element of doc.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const isHandler = name.startsWith("on");
      const isScriptUrl =
        (name === "href" || name.endsWith(":href") || name === "src" || name === "action") &&
        /^\s*javascript:/i.test(attribute.value);
      if (isHandler || isScriptUrl) {
        element.removeAttributeNode(attribute);
      }
    }
  }
  if (documentType === "text/html") {
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  }
  return new XMLSerializer().serializeToString(doc);
}

function eventDetail(event: Event): object | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }
  const detail: unknown = event.detail;
  return typeof detail === "object" && detail !== null ? detail : null;
}

/** Keeps a book's scripts from loading, and strips active content from its sections. */
export function guardEpubContent(target: EventTarget) {
  target.addEventListener("load", (event) => {
    const detail = eventDetail(event);
    if (detail !== null && "isScript" in detail && detail.isScript === true) {
      Reflect.set(detail, "allow", false);
    }
  });
  target.addEventListener("data", (event) => {
    const detail = eventDetail(event);
    if (detail === null || !("type" in detail) || !("data" in detail)) {
      return;
    }
    const { type, data } = detail;
    if (typeof type !== "string" || !markupTypes.has(type)) {
      return;
    }
    Reflect.set(
      detail,
      "data",
      Promise.resolve(data).then((value: unknown) =>
        typeof value === "string" ? stripActiveContent(value, type) : value,
      ),
    );
  });
}

/**
 * The styles laid over every section: the reader's text size, code that wraps
 * instead of running off the page, and in the dark theme the reader's colors
 * in place of the book's. The page background is left to the reader.
 */
export function epubStyles(fontScale: number, theme: EpubTheme): string {
  const base = `
html {
  font-size: ${fontScale}% !important;
  background: transparent !important;
  -webkit-text-size-adjust: none;
}
body { background: transparent !important; }
p, li, blockquote, dd { line-height: 1.7; widows: 2; orphans: 2; }
pre {
  white-space: pre-wrap !important;
  overflow-wrap: anywhere !important;
}
::selection { background: rgb(112 141 145 / 32%); }
`;
  if (theme !== "dark") {
    return `${base}html { color-scheme: light; color: #20252a; }\n`;
  }
  return `${base}
html { color-scheme: dark; color: #e1e5e2 !important; }
body, body *:not(img):not(svg):not(svg *):not(video):not(canvas) {
  color: inherit !important;
  background-color: transparent !important;
  border-color: rgb(255 255 255 / 18%) !important;
}
a, a * { color: #9cc1c5 !important; }
pre, code { background-color: rgb(255 255 255 / 5%) !important; }
img { background: #f7f7f3; }
`;
}

export type EpubTocLine = {
  key: string;
  label: string;
  href: string;
  depth: number;
};

/** Flattens the nested table of contents into indented lines. */
export function flattenToc(
  items: FoliateTocItem[] | null | undefined,
  depth = 0,
  prefix = "",
): EpubTocLine[] {
  const lines: EpubTocLine[] = [];
  for (const [position, item] of (items ?? []).entries()) {
    const key = `${prefix}${position}`;
    if (item.href) {
      lines.push({ key, label: (item.label ?? "").trim(), href: item.href, depth });
    }
    lines.push(...flattenToc(item.subitems, depth + 1, `${key}.`));
  }
  return lines;
}

export const defaultReaderSettings: ReaderSettings = { epubFontScale: 100, epubLayout: "spread" };

/**
 * The fill of each highlight color. foliate-js draws it at the opacity the
 * reader sets, under the text, so it reads in both themes.
 */
export const epubHighlightFills: Record<HighlightColor, string> = {
  yellow: "#ffd000",
  green: "#4cc552",
  pink: "#ff5ca0",
  purple: "#9664ff",
};

/** Orders highlights as they appear in the book. */
export function sortEpubHighlights(highlights: BookHighlight[]): BookHighlight[] {
  return highlights.toSorted((a, b) => {
    if (a.pageNumber !== b.pageNumber) {
      return a.pageNumber - b.pageNumber;
    }
    try {
      return compareCFI(a.cfi, b.cfi) || a.id - b.id;
    } catch {
      return a.id - b.id;
    }
  });
}

/** Orders bookmarks as they appear in the book. */
export function sortEpubBookmarks(bookmarks: BookBookmark[]): BookBookmark[] {
  return bookmarks.toSorted((a, b) => {
    if (a.pageNumber !== b.pageNumber) {
      return a.pageNumber - b.pageNumber;
    }
    try {
      return compareCFI(a.cfi, b.cfi);
    } catch {
      return a.progress - b.progress;
    }
  });
}

/** The place a page starts, from the CFI of the range the page shows. */
export function pageStartCFI(pageCFI: string): string {
  try {
    return collapseCFI(pageCFI);
  } catch {
    return pageCFI;
  }
}

/**
 * Whether a place falls on the page that shows the given range. The page ends
 * where the next one starts, so that place belongs to the next page.
 */
export function isCFIOnPage(cfi: string, pageCFI: string): boolean {
  try {
    const start = collapseCFI(pageCFI);
    const end = collapseCFI(pageCFI, true);
    if (compareCFI(start, end) === 0) {
      return compareCFI(cfi, start) === 0;
    }
    return compareCFI(start, cfi) <= 0 && compareCFI(cfi, end) < 0;
  } catch {
    return false;
  }
}

const speechBlockSelector =
  "p, div, li, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, pre, figcaption, td, th, section, article, aside, header, footer";
// Ruby annotations repeat the reading of the text they sit on.
const speechSkipSelector = "rt, rp, script, style";

function isDocument(node: Node): node is Document {
  return node.nodeType === 9;
}

/**
 * The text a range shows, for reading aloud. Blocks are kept on lines of
 * their own, so a heading does not run into the paragraph after it.
 */
export function rangeSpeechText(range: Range): string {
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument ?? (isDocument(root) ? root : null);
  if (!doc) {
    return "";
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let lastBlock: Element | null = null;
  for (let node = root.nodeType === 3 ? root : walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(speechSkipSelector) || !range.intersectsNode(node)) {
      continue;
    }
    const data = node.nodeValue ?? "";
    const end = node === range.endContainer ? range.endOffset : data.length;
    const start = node === range.startContainer ? range.startOffset : 0;
    const block = parent.closest(speechBlockSelector);
    if (lastBlock !== null && block !== lastBlock) {
      parts.push("\n");
    }
    lastBlock = block;
    // Line breaks in the markup are spaces on the page.
    parts.push(data.slice(start, end).replaceAll(/\s+/g, " "));
    if (root.nodeType === 3) {
      break;
    }
  }
  return parts
    .join("")
    .replaceAll(/[^\S\n]+/g, " ")
    .replaceAll(/ *\n\s*/g, "\n")
    .trim();
}
