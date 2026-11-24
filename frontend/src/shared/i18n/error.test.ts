import { describe, expect, it } from "vitest";

import { LocalizedError, translateLocalizedError } from "./error";
import { resources, type TranslationKey } from "./i18n";

function translate(language: "en" | "ja") {
  return (key: TranslationKey, values: Record<string, string | number> = {}) => {
    let message = resources[language].translation[key];
    for (const [name, value] of Object.entries(values)) {
      message = message.replaceAll(`{${name}}`, String(value));
    }
    return message;
  };
}

describe("translateLocalizedError", () => {
  it("translates the key with its values", () => {
    const error = new LocalizedError("error.fetchPdf", { status: 404 });

    expect(translateLocalizedError(error, translate("en"))).toBe(
      resources.en.translation["error.fetchPdf"].replaceAll("{status}", "404"),
    );
  });

  it("keeps the translation key as the error message", () => {
    const error = new LocalizedError("error.invalidPdf");

    expect(error.message).toBe("error.invalidPdf");
    expect(error.name).toBe("LocalizedError");
  });
});
