import { describe, expect, it } from "vitest";
import { normalizePageText } from "./text";

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
