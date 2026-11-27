import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  getLibrarySettings: vi.fn(),
  saveLibrarySettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
  saveLanguageSettings: vi.fn(),
  searchLibrary: vi.fn(),
}));

vi.mock("../features/library/api", () => ({
  listBooks: mocks.listBooks,
  markBookCoverFailed: mocks.markBookCoverFailed,
  openBook: mocks.openBook,
  openBookFile: mocks.openBookFile,
  pendingIndexBooks: mocks.pendingIndexBooks,
  relinkBook: mocks.relinkBook,
  removeBook: mocks.removeBook,
  renameBook: mocks.renameBook,
  saveBookCover: mocks.saveBookCover,
  getLibrarySettings: mocks.getLibrarySettings,
  saveLibrarySettings: mocks.saveLibrarySettings,
  searchLibrary: mocks.searchLibrary,
}));
vi.mock("../features/reader/api", () => ({
  saveReadingPosition: mocks.saveReadingPosition,
}));
vi.mock("../shared/api/settings", () => ({
  getAppearanceSettings: mocks.getAppearanceSettings,
  getLanguageSettings: mocks.getLanguageSettings,
  saveAppearanceSettings: mocks.saveAppearanceSettings,
  saveLanguageSettings: mocks.saveLanguageSettings,
}));
const settingsEvents = vi.hoisted(() => ({
  appearance: [] as Array<(theme: string) => void>,
  language: [] as Array<(language: string) => void>,
}));
vi.mock("../shared/api/events", () => ({
  onAppearanceChanged: (callback: (theme: string) => void) => {
    settingsEvents.appearance.push(callback);
    return () => {
      settingsEvents.appearance = settingsEvents.appearance.filter((entry) => entry !== callback);
    };
  },
  onLanguageChanged: (callback: (language: string) => void) => {
    settingsEvents.language.push(callback);
    return () => {
      settingsEvents.language = settingsEvents.language.filter((entry) => entry !== callback);
    };
  },
}));
vi.mock("../features/library/indexer", () => ({
  indexBookPages: mocks.indexBookPages,
  isAbortError: () => false,
}));
vi.mock("../features/library/generateCover", () => ({
  generateCoverThumbnail: mocks.generateCoverThumbnail,
}));
vi.mock("../features/reader/pdf/PdfReader", () => ({
  PdfReader: ({
    book,
    initialPage,
    onPageChange,
    onBack,
  }: {
    book: { name: string } | null;
    initialPage: number;
    onPageChange: (page: number, pageCount: number) => void;
    onBack: () => void;
  }) => (
    <div data-testid="pdf-reader">
      <span>{book?.name ?? "no-book"}</span>
      <span>initial-{initialPage}</span>
      <button type="button" onClick={() => onPageChange(4, 12)}>
        set-page
      </button>
      <button type="button" onClick={onBack}>
        back-to-library
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
  mocks.getLibrarySettings.mockResolvedValue({ sortOrder: "recent" });
  mocks.saveLibrarySettings.mockImplementation(async (settings: unknown) => settings);
  mocks.saveAppearanceSettings.mockImplementation(async (theme: string) => ({ theme }));
  mocks.saveLanguageSettings.mockImplementation(async (language: string) => ({ language }));
  settingsEvents.appearance = [];
  settingsEvents.language = [];
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

  it("defaults to English and follows a language saved in the settings window", async () => {
    mocks.getLanguageSettings.mockResolvedValue({ language: "en" });
    render(<App />);

    expect(await screen.findByText("Add your first book.")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");

    act(() => settingsEvents.language.forEach((callback) => callback("ja")));
    expect(await screen.findByText("最初の一冊を、本棚へ。")).toBeTruthy();
    expect(document.documentElement.lang).toBe("ja");
    expect(mocks.saveLanguageSettings).not.toHaveBeenCalled();
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
    expect(screen.getByRole("heading", { name: "本棚", level: 1 })).toHaveProperty(
      "className",
      "visually-hidden",
    );

    fireEvent.click(screen.getByRole("button", { name: "本を追加" }));
    expect(screen.getByText("選択しています…")).toBeTruthy();
    resolveEmpty({ ...openedBook, id: "", url: "" });
    await waitFor(() => expect(screen.getByRole("button", { name: "本を追加" })).toBeTruthy());

    mocks.openBookFile.mockResolvedValueOnce(openedBook);
    fireEvent.click(screen.getByRole("button", { name: "本を追加" }));
    await waitFor(() => expect(screen.getByText("initial-3")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "set-page" }));
    expect(mocks.saveReadingPosition).toHaveBeenCalledWith("book-1", 4, 12, "");

    mocks.listBooks.mockResolvedValue([{ ...summary, lastPage: 4 }]);
    mocks.openBook.mockResolvedValue({ ...openedBook, initialPage: 4 });
    fireEvent.click(screen.getByRole("button", { name: "back-to-library" }));
    expect(screen.queryByRole("button", { name: /読書に戻る/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Guideを開く" }));
    expect(await screen.findByText("initial-4")).toBeTruthy();
    unmount();
  });

  it("turns the top bar into the library search with Command-F and closes it with Escape", async () => {
    render(<App />);
    await screen.findByText("最初の一冊を、本棚へ。");

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const searchBox = await screen.findByRole("searchbox", { name: "検索語" });
    expect(
      screen.getByText(
        "キーワードを入力すると、タイトルで本を探したり、準備済みのページを横断検索したりできます。",
      ),
    ).toBeTruthy();
    fireEvent.keyDown(searchBox, { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "検索語" })).toBeNull();
    expect(await screen.findByText("最初の一冊を、本棚へ。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "本棚を検索（⌘F）" }));
    const reopened = await screen.findByRole("searchbox", { name: "検索語" });

    reopened.blur();
    fireEvent.keyDown(window, { key: "Escape", isComposing: true });
    expect(screen.getByRole("searchbox", { name: "検索語" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "検索語" })).toBeNull();
  });

  it("searches the text of every book while typing, without pressing Return", async () => {
    mocks.listBooks.mockResolvedValue([summary]);
    mocks.searchLibrary.mockResolvedValue([
      {
        book: summary,
        totalMatches: 2,
        pages: [
          {
            pageNumber: 7,
            location: "page:7",
            headingPath: "",
            excerpt: "context builder",
            matchCount: 2,
          },
        ],
      },
    ]);
    render(<App />);
    await screen.findByRole("button", { name: "Guideを開く" });

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const searchBox = await screen.findByRole("searchbox", { name: "検索語" });
    fireEvent.change(searchBox, { target: { value: "cont" } });
    fireEvent.change(searchBox, { target: { value: "context" } });

    expect(await screen.findByRole("button", { name: "Guideの7ページを開く" })).toBeTruthy();
    expect(mocks.searchLibrary).toHaveBeenCalledOnce();
    expect(mocks.searchLibrary).toHaveBeenCalledWith("context");
  });

  it("opens a saved book at its reading position", async () => {
    mocks.listBooks.mockResolvedValue([summary]);
    mocks.openBook.mockResolvedValue(openedBook);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Guideを開く" }));
    expect(await screen.findByText("initial-3")).toBeTruthy();
    expect(mocks.openBook).toHaveBeenCalledWith("book-1");
  });

  it("renames a saved book from its context menu", async () => {
    mocks.listBooks.mockResolvedValue([summary]);
    mocks.renameBook.mockResolvedValue({ ...summary, title: "Architecture Guide" });
    render(<App />);

    fireEvent.contextMenu(
      within(await screen.findByRole("region", { name: "import済みの本" })).getByRole("heading", {
        name: "Guide",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "名前を変更" }));
    const input = await screen.findByLabelText("Guideの表示名");
    fireEvent.change(input, { target: { value: "Architecture Guide" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(mocks.renameBook).toHaveBeenCalledWith("book-1", "Architecture Guide"),
    );
    expect(await screen.findAllByRole("heading", { name: "Architecture Guide" })).toHaveLength(2);
  });

  it("restores the theme and follows the theme saved in the settings window", async () => {
    mocks.getAppearanceSettings.mockResolvedValue({ theme: "dark" });
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    act(() => settingsEvents.appearance.forEach((callback) => callback("light")));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(mocks.saveAppearanceSettings).not.toHaveBeenCalled();
  });

  it("generates a pending cover without blocking the reader", async () => {
    mocks.openBookFile.mockResolvedValue({ ...openedBook, coverStatus: "pending" });
    render(<App />);
    await screen.findByText("最初の一冊を、本棚へ。");

    fireEvent.click(screen.getByRole("button", { name: "本を追加" }));
    await waitFor(() =>
      expect(mocks.saveBookCover).toHaveBeenCalledWith("book-1", "data:image/png;base64,cover"),
    );
    expect(screen.getByTestId("pdf-reader")).toBeTruthy();
  });

  it.each([
    [new Error("dialog failed"), "dialog failed"],
    ["unknown", "本を追加できませんでした。"],
  ])("shows PDF selection errors", async (reason, message) => {
    mocks.openBookFile.mockRejectedValueOnce(reason);
    render(<App />);
    await screen.findByText("最初の一冊を、本棚へ。");

    fireEvent.click(screen.getByRole("button", { name: "本を追加" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining(message),
    );
  });
});
