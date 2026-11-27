import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultReaderSettings,
  epubStyles,
  flattenToc,
  forgetLegacyReaderSettings,
  guardEpubContent,
  isCFIOnPage,
  pageStartCFI,
  rangeSpeechText,
  readLegacyReaderSettings,
  sortEpubBookmarks,
  sortEpubHighlights,
  stripActiveContent,
  takeLegacyEpubPosition,
} from "./epubContent";
import type { BookBookmark, BookHighlight } from "../../shared/api/backend";

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

describe("legacy storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("takes the position an earlier version kept, once", () => {
    expect(takeLegacyEpubPosition("book")).toBeNull();
    window.localStorage.setItem(
      "glint.epub.position.book",
      JSON.stringify({ section: 3, cfi: "epubcfi(/6/6!/4/2)" }),
    );
    expect(takeLegacyEpubPosition("book")).toEqual({ section: 3, cfi: "epubcfi(/6/6!/4/2)" });
    expect(window.localStorage.getItem("glint.epub.position.book")).toBeNull();

    window.localStorage.setItem("glint.epub.position.bad", '{"section":1,"cfi":"x"}');
    expect(takeLegacyEpubPosition("bad")).toBeNull();
    expect(window.localStorage.getItem("glint.epub.position.bad")).toBeNull();
  });

  it("lays the text size and layout an earlier version kept over the saved settings", () => {
    const saved = { epubFontScale: 120, epubLayout: "spread" as const };
    expect(readLegacyReaderSettings(saved)).toBeNull();

    window.localStorage.setItem("glint.epub.layout", "single");
    expect(readLegacyReaderSettings(saved)).toEqual({ epubFontScale: 120, epubLayout: "single" });
    window.localStorage.setItem("glint.epub.fontScale", "130");
    expect(readLegacyReaderSettings(defaultReaderSettings)).toEqual({
      epubFontScale: 130,
      epubLayout: "single",
    });
    // A size out of range keeps the saved one.
    window.localStorage.setItem("glint.epub.fontScale", "999");
    expect(readLegacyReaderSettings(saved)?.epubFontScale).toBe(120);

    forgetLegacyReaderSettings();
    expect(readLegacyReaderSettings(saved)).toBeNull();
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

function makeBookmark(pageNumber: number, cfi: string): BookBookmark {
  return { pageNumber, cfi, progress: 0, createdAt: "" };
}

describe("bookmarks", () => {
  const page = "epubcfi(/6/4!/4,/2/1:0,/10/1:5)";

  it("marks a page by where it starts", () => {
    expect(pageStartCFI(page)).toBe("epubcfi(/6/4!/4/2/1:0)");
  });

  it("finds the bookmarks that fall on a page", () => {
    expect(isCFIOnPage("epubcfi(/6/4!/4/2/1:0)", page)).toBe(true);
    expect(isCFIOnPage("epubcfi(/6/4!/4/6/1:3)", page)).toBe(true);
    // The next page starts where this one ends.
    expect(isCFIOnPage("epubcfi(/6/4!/4/10/1:5)", page)).toBe(false);
    expect(isCFIOnPage("epubcfi(/6/2!/4/6/1:3)", page)).toBe(false);
    expect(isCFIOnPage("epubcfi(/6/6!/4/2/1:0)", page)).toBe(false);
    expect(isCFIOnPage("epubcfi(/6/4!/4/2)", "epubcfi(/6/4!/4/2)")).toBe(true);
    expect(isCFIOnPage("not a cfi", page)).toBe(false);
  });

  it("orders bookmarks as they appear in the book", () => {
    const sorted = sortEpubBookmarks([
      makeBookmark(2, "epubcfi(/6/4!/4/2/1:0)"),
      makeBookmark(1, "epubcfi(/6/2!/4/10/1:0)"),
      makeBookmark(1, "epubcfi(/6/2!/4/4/1:0)"),
    ]);
    expect(sorted.map((bookmark) => bookmark.cfi)).toEqual([
      "epubcfi(/6/2!/4/4/1:0)",
      "epubcfi(/6/2!/4/10/1:0)",
      "epubcfi(/6/4!/4/2/1:0)",
    ]);
  });
});

describe("rangeSpeechText", () => {
  it("reads what the page shows, a block to a line, without ruby readings", () => {
    const doc = document.implementation.createHTMLDocument("section");
    doc.body.innerHTML =
      "<h1>Chapter   One</h1><p id='first'>The opening line\n  runs on.</p>" +
      "<p><ruby>漢字<rt>かんじ</rt></ruby>を読む</p><p id='last'>Cut here</p><script>x()</script>";
    const range = doc.createRange();
    range.setStart((doc.querySelector("#first") as Element).firstChild as Node, 4);
    range.setEnd((doc.querySelector("#last") as Element).firstChild as Node, 3);

    expect(rangeSpeechText(range)).toBe("opening line runs on.\n漢字を読む\nCut");
  });

  it("reads a range inside one text node", () => {
    const doc = document.implementation.createHTMLDocument("section");
    doc.body.innerHTML = "<p>Only part of this</p>";
    const text = (doc.querySelector("p") as Element).firstChild as Node;
    const range = doc.createRange();
    range.setStart(text, 5);
    range.setEnd(text, 9);
    expect(rangeSpeechText(range)).toBe("part");
  });
});
