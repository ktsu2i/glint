import type { TFunction } from "i18next";

import type { TranslationKey } from "./i18n";

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

type DynamicTranslate = Translate | TFunction;

function asTranslate(translate: DynamicTranslate): Translate {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 実行時に決まる動的 key を扱うため、型を意図的に緩める。
  return translate as Translate;
}

export function translateLocalizedError(error: LocalizedError, translate: DynamicTranslate) {
  return asTranslate(translate)(error.translationKey, error.values);
}
