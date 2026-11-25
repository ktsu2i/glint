import { act, fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  addHighlight: vi.fn(),
  changeHighlightColor: vi.fn(),
  listHighlights: vi.fn(),
  removeHighlight: vi.fn(),
  searchBook: vi.fn(),
  setWindowControlsVisible: vi.fn(),
}));

const foliate = vi.hoisted(() => ({
  createFoliateView: vi.fn(),
  views: [] as unknown[],
}));

vi.mock("../../shared/api/backend", () => ({
  addHighlight: backend.addHighlight,
  changeHighlightColor: backend.changeHighlightColor,
  listHighlights: backend.listHighlights,
  removeHighlight: backend.removeHighlight,
  searchBook: backend.searchBook,
  setWindowControlsVisible: backend.setWindowControlsVisible,
}));
vi.mock("./foliate", () => ({ createFoliateView: foliate.createFoliateView }));

import { EpubReader } from "./EpubReader";
import { I18nProvider } from "../../shared/i18n/i18n";
import type { BookFile, BookHighlight } from "../../shared/api/backend";

/** Stands in for foliate-js's <foliate-view>, recording what the reader asks of it. */
class FakeView extends HTMLElement {
  renderer = Object.assign(document.createElement("div"), { setStyles: vi.fn() });
  book = {
    dir: "ltr",
    sections: [{}, {}, {}],
    toc: [
      { label: "Chapter One", href: "c1.xhtml", subitems: [{ label: "1.1", href: "c1.xhtml#a" }] },
      { label: "Chapter Two", href: "c2.xhtml" },
    ],
    transformTarget: new EventTarget(),
  };
  open = vi.fn(async () => {});
  close = vi.fn();
  init = vi.fn(async () => {});
  goTo = vi.fn(async () => {});
  goToFraction = vi.fn(async () => {});
  goLeft = vi.fn(async () => {});
  goRight = vi.fn(async () => {});
  next = vi.fn(async () => {});
  prev = vi.fn(async () => {});
  clearSearch = vi.fn();
  getCFI = vi.fn((_index: number, _range: Range) => "epubcfi(/6/2!/4/2,/1:0,/1:4)");
  getTOCItemOf = vi.fn(async (_target: string) => ({ label: "Chapter One" }));
  // Draws like foliate-js does: it asks the reader how to draw each annotation.
  addAnnotation = vi.fn(async (annotation: { value: string }) => {
    this.dispatchEvent(
      new CustomEvent("draw-annotation", {
        detail: {
          annotation,
          draw: (_drawer: unknown, options: { color: string }) =>
            this.drawn.set(annotation.value, options.color),
        },
      }),
    );
  });
  deleteAnnotation = vi.fn(async (annotation: { value: string }) => {
    this.drawn.delete(annotation.value);
  });
  drawn = new Map<string, string>();
  search = vi.fn(async function* () {
    yield { cfi: "epubcfi(/6/4!/4/2)", excerpt: {} };
    yield "done" as const;
  });

  relocate(section: number, fraction: number, label = "Chapter One") {
    act(() => {
      this.dispatchEvent(
        new CustomEvent("relocate", {
          detail: {
            fraction,
            section: { current: section, total: 3 },
            tocItem: { label, href: "c1.xhtml" },
            cfi: `epubcfi(/6/${(section + 1) * 2}!/4/2)`,
          },
        }),
      );
    });
  }

  loadSection(): Document {
    const doc = document.implementation.createHTMLDocument("section");
    doc.body.innerHTML = '<p id="text">Text</p><a id="link" href="c2.xhtml">Next</a>';
    act(() => {
      this.dispatchEvent(new CustomEvent("load", { detail: { doc, index: 0 } }));
    });
    return doc;
  }
}
customElements.define("fake-foliate-view", FakeView);

function render(ui: ReactNode) {
  return renderBase(ui, {
    wrapper: ({ children }) => <I18nProvider initialLanguage="ja">{children}</I18nProvider>,
  });
}

function makeBook(): BookFile {
  return {
    id: "epub-1",
    title: "Reflowable Guide",
    name: "guide.epub",
    url: "/book/epub-1",
    format: "epub",
    size: 10,
    initialPage: 1,
    indexedPageCount: 3,
    nextSegment: 4,
    coverStatus: "ready",
  };
}

async function openReader(initialSection = 1, onPageChange = vi.fn()) {
  render(
    <EpubReader book={makeBook()} initialSection={initialSection} onPageChange={onPageChange} />,
  );
  await waitFor(() => expect(foliate.views).toHaveLength(1));
  const view = foliate.views[0] as FakeView;
  await waitFor(() => expect(view.init.mock.calls.length + view.goTo.mock.calls.length).toBe(1));
  return { view, onPageChange };
}

describe("EpubReader", () => {
  beforeEach(() => {
    window.localStorage.clear();
    foliate.views.length = 0;
    foliate.createFoliateView.mockReset().mockImplementation(async () => {
      const view = new FakeView();
      foliate.views.push(view);
      return { view, drawHighlight: vi.fn() };
    });
    backend.listHighlights.mockReset().mockResolvedValue([]);
    backend.addHighlight.mockReset();
    backend.changeHighlightColor.mockReset();
    backend.removeHighlight.mockReset().mockResolvedValue(undefined);
    backend.searchBook.mockReset();
    backend.setWindowControlsVisible.mockReset().mockResolvedValue(undefined);
  });

  it("opens the book as pages and reports where the reader is", async () => {
    const { view, onPageChange } = await openReader();

    expect(view.open).toHaveBeenCalledWith("/book/epub-1");
    expect(view.renderer.getAttribute("flow")).toBe("paginated");
    expect(view.renderer.getAttribute("max-column-count")).toBe("2");
    expect(view.init).toHaveBeenCalledWith({ showTextStart: true });

    view.relocate(1, 0.42);
    expect(onPageChange).toHaveBeenLastCalledWith(2, 3);
    expect(screen.getByText("Chapter One · 42%")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("glint.epub.position.epub-1") ?? "")).toEqual({
      section: 2,
      cfi: "epubcfi(/6/4!/4/2)",
    });

    // A report before the pages are counted keeps the last progress.
    view.relocate(1, Number.NaN);
    expect(screen.getByText("Chapter One · 42%")).toBeTruthy();
  });

  it("reopens on the saved page when the library agrees on the section", async () => {
    window.localStorage.setItem(
      "glint.epub.position.epub-1",
      JSON.stringify({ section: 2, cfi: "epubcfi(/6/4!/4/10)" }),
    );
    const { view } = await openReader(2);
    expect(view.init).toHaveBeenCalledWith({ lastLocation: "epubcfi(/6/4!/4/10)" });
  });

  it("opens the section a library search points at", async () => {
    window.localStorage.setItem(
      "glint.epub.position.epub-1",
      JSON.stringify({ section: 2, cfi: "epubcfi(/6/4!/4/10)" }),
    );
    const { view } = await openReader(3);
    expect(view.goTo).toHaveBeenCalledWith(2);
    expect(view.init).not.toHaveBeenCalled();
  });

  it("turns pages from the keyboard, inside the page as well", async () => {
    const { view } = await openReader();
    view.relocate(0, 0.1);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(view.goRight).toHaveBeenCalledTimes(1);

    const doc = view.loadSection();
    act(() => {
      doc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(view.goLeft).toHaveBeenCalledTimes(1);
  });

  it("shows and hides the bars from a click on the page, but not on a link", async () => {
    const { view } = await openReader();
    view.relocate(0, 0.1);
    const reader = screen.getByRole("region", { name: "EPUBリーダー" });
    const doc = view.loadSection();
    expect(reader.classList.contains("is-chrome-visible")).toBe(true);

    act(() => {
      doc.querySelector("#link")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(reader.classList.contains("is-chrome-visible")).toBe(true);

    act(() => {
      doc.querySelector("#text")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(reader.classList.contains("is-chrome-visible")).toBe(false));
  });

  it("closes a highlight's colors instead of the bars when the click lands on a highlight", async () => {
    const saved = highlight({ id: 4, cfi: "epubcfi(/6/2!/4/2,/1:0,/1:4)" });
    backend.listHighlights.mockResolvedValue([saved]);
    const { view } = await openReader();
    view.relocate(0, 0.1);
    const reader = screen.getByRole("region", { name: "EPUBリーダー" });
    const doc = view.loadSection();
    await waitFor(() => expect(view.drawn.has(saved.cfi)).toBe(true));

    // foliate-js reports the highlight after the page's own click handler runs.
    act(() => {
      doc.querySelector("#text")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      view.dispatchEvent(
        new CustomEvent("show-annotation", {
          detail: { value: saved.cfi, index: 0, range: selectInFrame(doc) },
        }),
      );
    });
    expect(await screen.findByRole("toolbar", { name: "ハイライト" })).toBeTruthy();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(reader.classList.contains("is-chrome-visible")).toBe(true);
  });

  it("keeps links out of the book closed", async () => {
    const { view } = await openReader();
    const event = new CustomEvent("external-link", { cancelable: true, detail: {} });
    view.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("guards the book's content before the first section loads", async () => {
    const { view } = await openReader();
    const script = { isScript: true, allow: true };
    view.book.transformTarget.dispatchEvent(new CustomEvent("load", { detail: script }));
    expect(script.allow).toBe(false);
  });

  it("jumps through the table of contents", async () => {
    const { view } = await openReader();
    view.relocate(0, 0.1);

    fireEvent.click(screen.getByRole("button", { name: "目次を開く" }));
    const entry = screen.getByRole("button", { name: "1.1" });
    expect(entry.style.paddingLeft).toBe("24px");
    expect(screen.getByRole("button", { name: "Chapter One" }).className).toContain("is-active");
    fireEvent.click(entry);
    expect(view.goTo).toHaveBeenCalledWith("c1.xhtml#a");
  });

  it("searches the book and lands on the match", async () => {
    backend.searchBook.mockResolvedValue([
      {
        pageNumber: 2,
        location: "spine:1",
        headingPath: "Chapter Two",
        excerpt: "a channel",
        matchCount: 1,
      },
    ]);
    const { view } = await openReader();
    view.relocate(0, 0.1);

    fireEvent.click(screen.getByRole("button", { name: "本の中を検索" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "channel" } });
    fireEvent.submit(screen.getByRole("search"));

    fireEvent.click(await screen.findByRole("button", { name: "Chapter Twoへ移動" }));
    expect(backend.searchBook).toHaveBeenCalledWith("epub-1", "channel");
    await waitFor(() => expect(view.goTo).toHaveBeenCalledWith("epubcfi(/6/4!/4/2)"));
    expect(view.search).toHaveBeenCalledWith({ query: "channel", index: 1 });
  });

  it("changes the text size and keeps it", async () => {
    const { view } = await openReader();
    view.relocate(0, 0.1);

    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    fireEvent.click(screen.getByRole("button", { name: "文字を大きく" }));
    expect(screen.getByText("110%")).toBeTruthy();
    expect(view.renderer.setStyles).toHaveBeenLastCalledWith(
      expect.stringContaining("font-size: 110%"),
    );
    expect(window.localStorage.getItem("glint.epub.fontScale")).toBe("110");
  });

  it("explains when the book cannot be opened", async () => {
    foliate.createFoliateView.mockImplementation(async () => {
      const view = new FakeView();
      view.open.mockRejectedValue(new Error("broken"));
      foliate.views.push(view);
      return { view, drawHighlight: vi.fn() };
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<EpubReader book={makeBook()} onPageChange={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe("EPUBを開けませんでした。");
  });

  it("switches between single pages and spreads, and keeps the choice", async () => {
    const { view } = await openReader();
    view.relocate(0, 0.1);
    expect(view.renderer.getAttribute("max-column-count")).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    fireEvent.click(screen.getByRole("button", { name: "片開き" }));
    expect(view.renderer.getAttribute("max-column-count")).toBe("1");
    expect(window.localStorage.getItem("glint.epub.layout")).toBe("single");
    expect(screen.getByRole("button", { name: "片開き" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("draws saved highlights in their colors and lists them", async () => {
    backend.listHighlights.mockResolvedValue([
      highlight({ id: 2, pageNumber: 2, color: "green", cfi: "epubcfi(/6/4!/4/2,/1:0,/1:3)" }),
      highlight({ id: 1, pageNumber: 1, color: "pink", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:3)" }),
    ]);
    const { view } = await openReader();
    view.relocate(0, 0.1);

    await waitFor(() => expect(view.drawn.size).toBe(2));
    expect(view.drawn.get("epubcfi(/6/2!/4/2,/1:0,/1:3)")).toBe("#ff5ca0");

    fireEvent.click(screen.getByRole("button", { name: "ハイライトを開く" }));
    const links = await screen.findAllByRole("button", { name: /Chapter Oneのハイライトへ移動/ });
    expect(links.map((link) => link.textContent)).toEqual(["Chapter Onefirst", "Chapter Onefirst"]);
    fireEvent.click(links[0] as HTMLElement);
    expect(view.goTo).toHaveBeenCalledWith("epubcfi(/6/2!/4/2,/1:0,/1:3)");
  });

  it("highlights the selected text in the chosen color", async () => {
    const saved = highlight({ id: 9, color: "yellow", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:4)" });
    backend.addHighlight.mockResolvedValue(saved);
    const { view } = await openReader();
    view.relocate(0, 0.1, "Chapter One");
    const doc = view.loadSection();
    selectInFrame(doc);

    act(() => {
      doc.dispatchEvent(new MouseEvent("mouseup"));
    });
    fireEvent.click(await screen.findByRole("button", { name: "黄色でハイライト" }));

    await waitFor(() =>
      expect(backend.addHighlight).toHaveBeenCalledWith("epub-1", {
        pageNumber: 1,
        pageCount: 3,
        color: "yellow",
        text: "Text",
        rects: [],
        cfi: "epubcfi(/6/2!/4/2,/1:0,/1:4)",
      }),
    );
    await waitFor(() => expect(view.drawn.get(saved.cfi)).toBe("#ffd000"));
    expect(screen.queryByRole("toolbar", { name: "選択した文章をハイライト" })).toBeNull();
  });

  it("recolors and removes a highlight clicked on the page", async () => {
    const saved = highlight({ id: 3, color: "yellow", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:4)" });
    backend.listHighlights.mockResolvedValue([saved]);
    backend.changeHighlightColor.mockResolvedValue({ ...saved, color: "purple" });
    const { view } = await openReader();
    view.relocate(0, 0.1);
    const doc = view.loadSection();
    await waitFor(() => expect(view.drawn.get(saved.cfi)).toBe("#ffd000"));

    act(() => {
      view.dispatchEvent(
        new CustomEvent("show-annotation", {
          detail: { value: saved.cfi, index: 0, range: selectInFrame(doc) },
        }),
      );
    });
    fireEvent.click(await screen.findByRole("button", { name: "紫に変更" }));
    await waitFor(() => expect(view.drawn.get(saved.cfi)).toBe("#9664ff"));
    expect(backend.changeHighlightColor).toHaveBeenCalledWith("epub-1", 3, "purple");

    fireEvent.click(screen.getByRole("button", { name: "ハイライトを削除" }));
    await waitFor(() => expect(view.drawn.has(saved.cfi)).toBe(false));
    expect(backend.removeHighlight).toHaveBeenCalledWith("epub-1", 3);
  });
});

function highlight(overrides: Partial<BookHighlight>): BookHighlight {
  return {
    id: 1,
    pageNumber: 1,
    color: "yellow",
    text: "first",
    rects: [],
    cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)",
    createdAt: "2026-11-25T00:00:00Z",
    ...overrides,
  };
}

/** Selects the section's text as if it sat in a frame of the reader. */
function selectInFrame(doc: Document): Range {
  const frame = document.createElement("iframe");
  Object.defineProperty(doc, "defaultView", { configurable: true, value: { frameElement: frame } });
  const range = doc.createRange();
  range.selectNodeContents(doc.querySelector("#text") as Node);
  range.getBoundingClientRect = () => new DOMRect(40, 200, 80, 20);
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => "Text",
    removeAllRanges: vi.fn(),
  };
  doc.getSelection = () => selection as unknown as Selection;
  return range;
}
