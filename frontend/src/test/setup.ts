import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// @wailsio/runtime starts a 50 ms window.setInterval when it is imported (drag.js). When a test
// file finishes first, the callback runs after jsdom is torn down and throws "window is not
// defined". jsdom sets up the drag handlers synchronously on import, so load the runtime once
// here with that poll skipped; test files then reuse this module.
const setInterval = window.setInterval;
window.setInterval = () => 0;
await import("@wailsio/runtime");
window.setInterval = setInterval;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
