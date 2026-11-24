import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  handlers: new Map<string, (event: { data: unknown }) => void>(),
  off: vi.fn(),
}));

vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: (name: string, handler: (event: { data: unknown }) => void) => {
      runtime.handlers.set(name, handler);
      return runtime.off;
    },
  },
}));

import { onAppearanceChanged, onLanguageChanged } from "./events";

beforeEach(() => {
  runtime.handlers.clear();
  runtime.off.mockClear();
});

describe("settings events", () => {
  it("passes valid appearance changes and ignores malformed ones", () => {
    const callback = vi.fn();
    const off = onAppearanceChanged(callback);
    const handler = runtime.handlers.get("settings:appearance-changed")!;

    handler({ data: { theme: "dark" } });
    handler({ data: { theme: "sepia" } });
    handler({ data: null });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("dark");
    off();
    expect(runtime.off).toHaveBeenCalledOnce();
  });

  it("passes valid language changes and ignores malformed ones", () => {
    const callback = vi.fn();
    onLanguageChanged(callback);
    const handler = runtime.handlers.get("settings:language-changed")!;

    handler({ data: { language: "ja" } });
    handler({ data: { language: "fr" } });
    handler({ data: "ja" });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("ja");
  });
});
