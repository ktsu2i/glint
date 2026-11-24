import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_CONTEXT_CHARACTERS,
  contextPreview,
  normalizePageText,
  trimChatContext,
} from "./text";

describe("normalizePageText", () => {
  it("preserves line boundaries while removing layout whitespace", () => {
    expect(
      normalizePageText([
        { str: "Chapter", hasEOL: false },
        { str: "One", hasEOL: true },
        { str: "Body", hasEOL: false },
      ]),
    ).toBe("Chapter One\nBody");
  });

  it("normalizes missing strings, repeated spaces, and blank lines", () => {
    expect(
      normalizePageText([{}, { str: "  alpha   beta  ", hasEOL: true }, { str: "\n\n\n gamma" }]),
    ).toBe("alpha beta\n\n gamma");
  });
});

describe("trimChatContext", () => {
  it("limits context by Unicode characters", () => {
    const value = "あ".repeat(MAX_CHAT_CONTEXT_CHARACTERS + 10);
    expect(Array.from(trimChatContext(value))).toHaveLength(MAX_CHAT_CONTEXT_CHARACTERS);
  });

  it("trims short context without padding it", () => {
    expect(trimChatContext("  context  ")).toBe("context");
  });
});

describe("contextPreview", () => {
  it("collapses whitespace and marks truncation", () => {
    expect(contextPreview("one\n\n two three", 7)).toBe("one two…");
  });

  it("returns a short preview unchanged using the default maximum", () => {
    expect(contextPreview("  short\npreview  ")).toBe("short preview");
  });
});
