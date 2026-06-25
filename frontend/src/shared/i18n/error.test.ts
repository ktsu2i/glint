import { describe, expect, it } from "vitest";

import { localizeBackendError } from "./error";
import { resources, type TranslationKey } from "./i18n";

function translate(language: "en" | "ja") {
  return (key: TranslationKey, values: Record<string, string | number> = {}) => {
    let message = resources[language].translation[key] as string;
    for (const [name, value] of Object.entries(values)) {
      message = message.replaceAll(`{${name}}`, String(value));
    }
    return message;
  };
}

describe("localizeBackendError", () => {
  it("localizes provider-specific API key errors", () => {
    expect(localizeBackendError(
      "Anthropic API keyを確認してください。",
      translate("en"),
    )).toBe("Check the Anthropic API key.");
  });

  it("localizes generic stream errors with the provider name", () => {
    expect(localizeBackendError(
      "Googleのstreamが完了通知なしで終了しました。",
      translate("en"),
    )).toBe("The Google stream ended without a completion event.");
  });

  it("preserves unknown provider details", () => {
    expect(localizeBackendError("model overloaded", translate("en"))).toBe("model overloaded");
  });
});
