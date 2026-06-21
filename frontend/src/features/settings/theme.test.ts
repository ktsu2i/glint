import { describe, expect, it, vi } from "vitest";
import { syncDocumentTheme } from "./theme";

function mediaQuery(matches: boolean) {
  return {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
}

describe("syncDocumentTheme", () => {
  it.each(["light", "dark"] as const)("applies an explicit %s theme", (preference) => {
    const root = document.createElement("html");
    const query = mediaQuery(preference === "light");

    const cleanup = syncDocumentTheme(preference, root, query);

    expect(root.dataset.theme).toBe(preference);
    expect(root.dataset.themePreference).toBe(preference);
    expect(root.style.colorScheme).toBe(preference);
    expect(query.addEventListener).not.toHaveBeenCalled();
    cleanup();
  });

  it("follows system changes and removes its listener", () => {
    const root = document.createElement("html");
    const query = mediaQuery(true);

    const cleanup = syncDocumentTheme("system", root, query);

    expect(root.dataset.theme).toBe("dark");
    const listener = vi.mocked(query.addEventListener).mock.calls[0][1] as EventListener;
    Object.defineProperty(query, "matches", { value: false });
    listener(new Event("change"));
    expect(root.dataset.theme).toBe("light");

    cleanup();
    expect(query.removeEventListener).toHaveBeenCalledWith("change", listener);
  });
});
