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
});

describe("trimChatContext", () => {
  it("limits context by Unicode characters", () => {
    const value = "あ".repeat(MAX_CHAT_CONTEXT_CHARACTERS + 10);
    expect(Array.from(trimChatContext(value))).toHaveLength(MAX_CHAT_CONTEXT_CHARACTERS);
  });
});

describe("contextPreview", () => {
  it("collapses whitespace and marks truncation", () => {
    expect(contextPreview("one\n\n two three", 7)).toBe("one two…");
  });
});
