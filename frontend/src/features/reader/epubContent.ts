import type { FoliateTocItem } from "foliate-js/view.js";

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

export type SavedEpubPosition = { section: number; cfi: string };

const positionStorageKey = (bookId: string) => `glint.epub.position.${bookId}`;

/**
 * The library keeps the section; the exact spot in it, as an EPUB CFI, is
 * kept on this device so the book reopens on the same page.
 */
export function loadEpubPosition(bookId: string): SavedEpubPosition | null {
  try {
    const raw = window.localStorage.getItem(positionStorageKey(bookId));
    if (!raw) {
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const section = "section" in value ? value.section : undefined;
    const cfi = "cfi" in value ? value.cfi : undefined;
    if (typeof section !== "number" || typeof cfi !== "string" || !cfi.startsWith("epubcfi(")) {
      return null;
    }
    return { section, cfi };
  } catch {
    return null;
  }
}

export function saveEpubPosition(bookId: string, position: SavedEpubPosition) {
  try {
    window.localStorage.setItem(positionStorageKey(bookId), JSON.stringify(position));
  } catch {}
}

const fontScaleStorageKey = "glint.epub.fontScale";

export function loadEpubFontScale(): number {
  try {
    const value = Number(window.localStorage.getItem(fontScaleStorageKey));
    if (Number.isFinite(value) && value >= EPUB_MIN_FONT_SCALE && value <= EPUB_MAX_FONT_SCALE) {
      return value;
    }
  } catch {}
  return 100;
}

export function saveEpubFontScale(value: number) {
  try {
    window.localStorage.setItem(fontScaleStorageKey, String(value));
  } catch {}
}
