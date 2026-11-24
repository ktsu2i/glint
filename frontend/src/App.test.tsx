import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBooks: vi.fn(),
  markBookCoverFailed: vi.fn(),
  openBook: vi.fn(),
  openBookFile: vi.fn(),
  pendingIndexBooks: vi.fn(),
  indexBookPages: vi.fn(),
  relinkBook: vi.fn(),
  removeBook: vi.fn(),
  renameBook: vi.fn(),
  saveBookCover: vi.fn(),
  saveReadingPosition: vi.fn(),
  generateCoverThumbnail: vi.fn(),
  getAppearanceSettings: vi.fn(),
  getLanguageSettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
  saveLanguageSettings: vi.fn(),
}));

vi.mock("./shared/api/backend", () => ({
  listBooks: mocks.listBooks,
  markBookCoverFailed: mocks.markBookCoverFailed,
  openBook: mocks.openBook,
  openBookFile: mocks.openBookFile,
  pendingIndexBooks: mocks.pendingIndexBooks,
  relinkBook: mocks.relinkBook,
  removeBook: mocks.removeBook,
  renameBook: mocks.renameBook,
  saveBookCover: mocks.saveBookCover,
  saveReadingPosition: mocks.saveReadingPosition,
  getAppearanceSettings: mocks.getAppearanceSettings,
  getLanguageSettings: mocks.getLanguageSettings,
  saveAppearanceSettings: mocks.saveAppearanceSettings,
  saveLanguageSettings: mocks.saveLanguageSettings,
}));
vi.mock("./features/library/indexer", () => ({
  indexBookPages: mocks.indexBookPages,
  isAbortError: () => false,
}));
vi.mock("./features/library/generateCover", () => ({
  generateCoverThumbnail: mocks.generateCoverThumbnail,
}));
vi.mock("./features/reader/PdfReader", () => ({
  PdfReader: ({
    book,
    initialPage,
    onPageChange,
  }: {
    book: { name: string } | null;
    initialPage: number;
    onPageChange: (page: number, pageCount: number) => void;
  }) => (
    <div data-testid="pdf-reader">
      <span>{book?.name ?? "no-book"}</span>
      <span>initial-{initialPage}</span>
      <button type="button" onClick={() => onPageChange(4, 12)}>
        set-page
      </button>
    </div>
  ),
}));
import App from "./App";

const openedBook = {
  id: "book-1",
  title: "Guide",
  name: "Guide.pdf",
  url: "/book/1",
  size: 10,
  initialPage: 3,
  indexedPageCount: 0,
  nextSegment: 1,
  coverStatus: "ready" as const,
};

const summary = {
  id: "book-1",
  title: "Guide",
  fileName: "Guide.pdf",
  size: 10,
  pageCount: 12,
  lastPage: 3,
  importedAt: "2026-06-21T00:00:00Z",
  lastOpenedAt: "2026-06-21T01:00:00Z",
  coverUrl: "/cover/1",
  coverStatus: "ready" as const,
  available: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.className = "";
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
  document.documentElement.style.colorScheme = "";
  mocks.listBooks.mockResolvedValue([]);
  mocks.pendingIndexBooks.mockResolvedValue([]);
  mocks.indexBookPages.mockResolvedValue({ pageCount: 1, persistedCount: 1 });
  mocks.saveReadingPosition.mockResolvedValue(undefined);
  mocks.saveBookCover.mockResolvedValue(undefined);
  mocks.markBookCoverFailed.mockResolvedValue(undefined);
  mocks.generateCoverThumbnail.mockResolvedValue("data:image/png;base64,cover");
  mocks.getAppearanceSettings.mockResolvedValue({ theme: "system" });
  mocks.getLanguageSettings.mockResolvedValue({ language: "ja" });
  mocks.saveAppearanceSettings.mockImplementation(async (theme: string) => ({ theme }));
  mocks.saveLanguageSettings.mockImplementation(async (language: string) => ({ language }));
});

describe("App", () => {
  it("resumes unfinished PDF indexing one book at a time on startup", async () => {
    const first = { id: "book-1", url: "/book/1", nextSegment: 3, total: 5 };
    const second = { id: "book-2", url: "/book/2", nextSegment: 1, total: 2 };
    mocks.pendingIndexBooks.mockResolvedValue([first, second]);
    let finishFirst!: (value: { pageCount: number; persistedCount: number }) => void;
    mocks.indexBookPages.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
    );
    render(<App />);

    await waitFor(() => expect(mocks.indexBookPages).toHaveBeenCalledTimes(1));
    expect(mocks.indexBookPages.mock.calls[0]?.[0]).toEqual({
      id: "book-1",
      url: "/book/1",
      nextSegment: 3,
    });
    finishFirst({ pageCount: 5, persistedCount: 5 });
    await waitFor(() => expect(mocks.indexBookPages).toHaveBeenCalledTimes(2));
    expect(mocks.indexBookPages.mock.calls[1]?.[0]).toEqual({
      id: "book-2",
      url: "/book/2",
      nextSegment: 1,
    });
    expect(mocks.pendingIndexBooks).toHaveBeenCalledTimes(1);
  });

  it("defaults to English and switches the interface to Japanese from Settings", async () => {
    mocks.getLanguageSettings.mockResolvedValue({ language: "en" });
    render(<App />);

    expect(await screen.findByText("Add your first book.")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: /Japanese/ }));

    await waitFor(() => expect(mocks.saveLanguageSettings).toHaveBeenCalledWith("ja"));
    expect(await screen.findByRole("heading", { name: "設定", level: 1 })).toBeTruthy();
    expect(document.documentElement.lang).toBe("ja");
  });

  it("rolls back the language when persistence fails", async () => {
    mocks.getLanguageSettings.mockResolvedValue({ language: "en" });
    mocks.saveLanguageSettings.mockRejectedValue(new Error("language storage unavailable"));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: /Japanese/ }));

    expect(await screen.findByText("language storage unavailable")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("starts in the library, imports a PDF, saves the reading position, and returns", async () => {
    let resolveEmpty!: (value: typeof openedBook) => void;
    mocks.openBookFile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveEmpty = resolve;
      }),
    );
    const { unmount } = render(<App />);

    expect(await screen.findByText("最初の一冊を、本棚へ。")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "メインナビゲーション" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "本棚" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "読書" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "PDFを追加" }));
    expect(screen.getByText("選択しています…")).toBeTruthy();
    resolveEmpty({ ...openedBook, id: "", url: "" });
    await waitFor(() => expect(screen.getByRole("button", { name: "PDFを追加" })).toBeTruthy());

    mocks.openBookFile.mockResolvedValueOnce(openedBook);
    fireEvent.click(screen.getByRole("button", { name: "PDFを追加" }));
    await waitFor(() => expect(screen.getByText("initial-3")).toBeTruthy());
    expect(screen.getByRole("button", { name: "読書" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "set-page" }));
    expect(screen.getByLabelText("4ページ")).toBeTruthy();
    expect(screen.getByText("004")).toBeTruthy();
    expect(mocks.saveReadingPosition).toHaveBeenCalledWith("book-1", 4, 12);

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(await screen.findByRole("heading", { name: "設定", level: 1 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "設定" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "読書" }));
    expect(await screen.findByText("initial-4")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "本棚" }));
    expect(await screen.findByRole("heading", { name: "本棚" })).toBeTruthy();
    unmount();
  });

  it("opens a saved book at its reading position", async () => {
    mocks.listBooks.mockResolvedValue([summary]);
    mocks.openBook.mockResolvedValue(openedBook);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Guideを開く" }));
    expect(await screen.findByText("initial-3")).toBeTruthy();
    expect(mocks.openBook).toHaveBeenCalledWith("book-1");
  });

  it("renames a saved book from its title", async () => {
    mocks.listBooks.mockResolvedValue([summary]);
    mocks.renameBook.mockResolvedValue({ ...summary, title: "Architecture Guide" });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Guideの名前を変更" }));
    const input = screen.getByLabelText("Guideの表示名");
    fireEvent.change(input, { target: { value: "Architecture Guide" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(mocks.renameBook).toHaveBeenCalledWith("book-1", "Architecture Guide"),
    );
    expect(
      await screen.findByRole("button", {
        name: "Architecture Guideの名前を変更",
      }),
    ).toBeTruthy();
  });

  it("opens the settings page from the library and returns", async () => {
    render(<App />);
    await screen.findByText("最初の一冊を、本棚へ。");

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(await screen.findByRole("heading", { name: "設定", level: 1 })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "表示", level: 2 })).toBeTruthy();
    expect(screen.queryByText(/API key/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "本棚" }));
    expect(await screen.findByRole("heading", { name: "本棚" })).toBeTruthy();
  });

  it("restores, applies, and persists the appearance theme", async () => {
    mocks.getAppearanceSettings.mockResolvedValue({ theme: "dark" });
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    const light = await screen.findByRole("button", { name: /ライト/ });
    expect(screen.getByRole("button", { name: /ダーク/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(light);
    await waitFor(() => expect(mocks.saveAppearanceSettings).toHaveBeenCalledWith("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(light.getAttribute("aria-pressed")).toBe("true");
  });

  it("rolls back the visible theme when persistence fails", async () => {
    mocks.getAppearanceSettings.mockResolvedValue({ theme: "dark" });
    mocks.saveAppearanceSettings.mockRejectedValue(new Error("settings unavailable"));
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(await screen.findByRole("button", { name: /ライト/ }));

    expect(await screen.findByText("settings unavailable")).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: /ダーク/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("generates a pending cover without blocking the reader", async () => {
    mocks.openBookFile.mockResolvedValue({ ...openedBook, coverStatus: "pending" });
    render(<App />);
    await screen.findByText("最初の一冊を、本棚へ。");

    fireEvent.click(screen.getByRole("button", { name: "PDFを追加" }));
    await waitFor(() =>
      expect(mocks.saveBookCover).toHaveBeenCalledWith("book-1", "data:image/png;base64,cover"),
    );
    expect(screen.getByTestId("pdf-reader")).toBeTruthy();
  });

  it.each([
    [new Error("dialog failed"), "dialog failed"],
    ["unknown", "PDFを追加できませんでした。"],
  ])("shows PDF selection errors", async (reason, message) => {
    mocks.openBookFile.mockRejectedValueOnce(reason);
    render(<App />);
    await screen.findByText("最初の一冊を、本棚へ。");

    fireEvent.click(screen.getByRole("button", { name: "PDFを追加" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining(message),
    );
  });
});
