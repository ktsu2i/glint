import { beforeEach, describe, expect, it } from "vitest";
import {
  epubStyles,
  flattenToc,
  guardEpubContent,
  loadEpubFontScale,
  loadEpubLayout,
  loadEpubPosition,
  saveEpubFontScale,
  saveEpubLayout,
  saveEpubPosition,
  sortEpubHighlights,
  stripActiveContent,
} from "./epubContent";
import type { BookHighlight } from "../../shared/api/backend";

const section = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>s</title>
<meta http-equiv="refresh" content="0; url=https://example.com/"/></head>
<body onload="steal()"><h1>One</h1><script>steal()</script>
<p onclick="steal()">Text</p><a href="javascript:steal()">bad</a><a href="#ok">good</a>
<iframe src="https://example.com/"></iframe><img src="blob:x" alt="figure"/></body></html>`;

describe("stripActiveContent", () => {
  it("removes scripts, handlers, embeds and javascript links from XHTML", () => {
    const cleaned = stripActiveContent(section, "application/xhtml+xml");
    expect(cleaned).not.toMatch(/script|onclick|onload|javascript:|iframe|refresh/i);
    expect(cleaned).toContain("<h1>One</h1>");
    expect(cleaned).toContain('href="#ok"');
    expect(cleaned).toContain('src="blob:x"');
  });

  it("falls back to HTML for sections that are not well-formed XHTML", () => {
    const cleaned = stripActiveContent(
      "<html><body><p>Open<br><script>steal()</script></body></html>",
      "application/xhtml+xml",
    );
    expect(cleaned.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(cleaned).toContain("Open");
    expect(cleaned).not.toContain("steal");
  });
});

describe("guardEpubContent", () => {
  it("refuses script resources and cleans markup as it loads", async () => {
    const target = new EventTarget();
    guardEpubContent(target);

    const script = { isScript: true, allow: true };
    target.dispatchEvent(new CustomEvent("load", { detail: script }));
    expect(script.allow).toBe(false);

    const image = { isScript: false, allow: true };
    target.dispatchEvent(new CustomEvent("load", { detail: image }));
    expect(image.allow).toBe(true);

    const markup = { data: Promise.resolve(section), type: "application/xhtml+xml" };
    target.dispatchEvent(new CustomEvent("data", { detail: markup }));
    expect(await markup.data).not.toContain("<script");

    const style = { data: "body{}", type: "text/css" };
    target.dispatchEvent(new CustomEvent("data", { detail: style }));
    expect(style.data).toBe("body{}");
  });
});

describe("epubStyles", () => {
  it("sets the text size and keeps code on the page", () => {
    const css = epubStyles(120, "light");
    expect(css).toContain("font-size: 120% !important");
    expect(css).toContain("white-space: pre-wrap");
    expect(css).not.toContain("color-scheme: dark");
  });

  it("uses the reader's colors in the dark theme", () => {
    expect(epubStyles(100, "dark")).toContain("color-scheme: dark");
  });
});

describe("flattenToc", () => {
  it("indents nested entries and skips entries without a target", () => {
    expect(
      flattenToc([
        { label: " One ", href: "c1.xhtml", subitems: [{ label: "1.1", href: "c1.xhtml#a" }] },
        { label: "Part", subitems: [{ label: "Two", href: "c2.xhtml" }] },
      ]),
    ).toEqual([
      { key: "0", label: "One", href: "c1.xhtml", depth: 0 },
      { key: "0.0", label: "1.1", href: "c1.xhtml#a", depth: 1 },
      { key: "1.0", label: "Two", href: "c2.xhtml", depth: 1 },
    ]);
    expect(flattenToc(null)).toEqual([]);
  });
});

describe("storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps the exact position per book", () => {
    expect(loadEpubPosition("book")).toBeNull();
    saveEpubPosition("book", { section: 3, cfi: "epubcfi(/6/6!/4/2)" });
    expect(loadEpubPosition("book")).toEqual({ section: 3, cfi: "epubcfi(/6/6!/4/2)" });
    window.localStorage.setItem("glint.epub.position.bad", '{"section":1,"cfi":"x"}');
    expect(loadEpubPosition("bad")).toBeNull();
  });

  it("keeps the text size within its range", () => {
    expect(loadEpubFontScale()).toBe(100);
    saveEpubFontScale(130);
    expect(loadEpubFontScale()).toBe(130);
    saveEpubFontScale(999);
    expect(loadEpubFontScale()).toBe(100);
  });
});

function makeHighlight(id: number, pageNumber: number, cfi: string): BookHighlight {
  return {
    id,
    pageNumber,
    cfi,
    color: "yellow",
    text: "t",
    rects: [],
    createdAt: "",
  };
}

describe("sortEpubHighlights", () => {
  it("orders highlights as they appear in the book", () => {
    const sorted = sortEpubHighlights([
      makeHighlight(1, 2, "epubcfi(/6/4!/4/2,/1:0,/1:3)"),
      makeHighlight(2, 1, "epubcfi(/6/2!/4/10,/1:0,/1:3)"),
      makeHighlight(3, 1, "epubcfi(/6/2!/4/4,/1:5,/1:9)"),
    ]);
    expect(sorted.map((highlight) => highlight.id)).toEqual([3, 2, 1]);
  });
});

describe("layout", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to spreads and keeps a single page choice", () => {
    expect(loadEpubLayout()).toBe("spread");
    saveEpubLayout("single");
    expect(loadEpubLayout()).toBe("single");
  });
});
