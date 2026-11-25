import { act, fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  searchBook: vi.fn(),
  setWindowControlsVisible: vi.fn(),
}));

const foliate = vi.hoisted(() => ({
  createFoliateView: vi.fn(),
  views: [] as unknown[],
}));

vi.mock("../../shared/api/backend", () => ({
  searchBook: backend.searchBook,
  setWindowControlsVisible: backend.setWindowControlsVisible,
}));
vi.mock("./foliate", () => ({ createFoliateView: foliate.createFoliateView }));

import { EpubReader } from "./EpubReader";
import { I18nProvider } from "../../shared/i18n/i18n";
import type { BookFile } from "../../shared/api/backend";

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
      return view;
    });
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
    expect(reader.classList.contains("is-chrome-visible")).toBe(false);
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
      return view;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<EpubReader book={makeBook()} onPageChange={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe("EPUBを開けませんでした。");
  });
});
