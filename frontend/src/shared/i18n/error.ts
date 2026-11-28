import type { TranslationKey } from "./locales/en";

export class LocalizedError extends Error {
  readonly translationKey: TranslationKey;
  readonly values: Record<string, string | number> | undefined;

  constructor(translationKey: TranslationKey, values?: Record<string, string | number>) {
    super(translationKey);
    this.name = "LocalizedError";
    this.translationKey = translationKey;
    this.values = values;
  }
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function translateLocalizedError(error: LocalizedError, translate: Translate) {
  return translate(error.translationKey, error.values);
}
