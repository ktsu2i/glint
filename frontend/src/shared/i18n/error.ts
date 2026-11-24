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

function group(match: RegExpMatchArray, index: number): string {
  return match[index] ?? "";
}

function asTranslate(translate: DynamicTranslate): Translate {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 実行時に決まる動的 key を扱うため、型を意図的に緩める。
  return translate as Translate;
}

export function translateLocalizedError(error: LocalizedError, translate: DynamicTranslate) {
  return asTranslate(translate)(error.translationKey, error.values);
}

type ErrorPattern = {
  pattern: RegExp;
  key: TranslationKey;
  values: (match: RegExpMatchArray) => Record<string, string | number>;
};

const backendErrorKeys: Record<string, TranslationKey> = {
  "応答に時間がかかりすぎたため、質問を打ち切りました。": "chat.timeout",
  "provider接続テストがタイムアウトしました。": "settings.testConnectionTimeout",
  "LLM providerが選択されていません。": "chat.providerMissing",
  "このproviderは接続テストに対応していません。": "settings.testConnectionUnsupported",
};

const backendErrorPatterns: ErrorPattern[] = [
  {
    pattern: /^(.+)から不正なstream応答を受信しました。$/,
    key: "chat.invalidStream",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^(.+)のstream接続が中断されました。$/,
    key: "chat.streamInterrupted",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^(.+)のstreamが完了通知なしで終了しました。$/,
    key: "chat.streamIncomplete",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^(.+?)(?:の| )API keyを確認してください。$/,
    key: "chat.invalidApiKey",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^(.+?) API keyに必要な権限がありません。(?:.*)?$/,
    key: "chat.apiKeyPermission",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^(.+)のcredit残高を確認してください。$/,
    key: "chat.insufficientCredit",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^(.+)のusage limitに達した可能性があります。billingを確認してください。$/,
    key: "chat.usageLimit",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^(.+)のrate limitに達しました。少し待ってから再試行してください。$/,
    key: "chat.rateLimit",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^(.+)のmodelを(?:設定|入力)してください。$/,
    key: "chat.modelMissing",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^(.+)のAPI keyを設定してください。$/,
    key: "chat.apiKeyMissing",
    values: (match) => ({ provider: group(match, 1) }),
  },
  {
    pattern: /^Ollamaがmodelを認識していません。.*$/,
    key: "chat.ollamaModelMissing",
    values: () => ({}),
  },
  {
    pattern: /^connect to (.+?): (.+)$/,
    key: "chat.connectionFailed",
    values: (match) => ({ provider: group(match, 1), detail: group(match, 2) }),
  },
  {
    pattern: /^(.+) request failed \((\d+)\)(?:: (.+))?$/,
    key: "chat.requestFailed",
    values: (match) => ({
      provider: group(match, 1),
      status: group(match, 2),
      detail: group(match, 3),
    }),
  },
  {
    pattern: /^プロンプトが(.+)のsafety filterでブロックされました（(.+)）。$/,
    key: "chat.safetyBlocked",
    values: (match) => ({ provider: group(match, 1), reason: group(match, 2) }),
  },
];

export function localizeBackendError(message: string, dynamicTranslate: DynamicTranslate) {
  const translate = asTranslate(dynamicTranslate);
  const key = backendErrorKeys[message];
  if (key !== undefined) return translate(key);
  for (const candidate of backendErrorPatterns) {
    const match = message.match(candidate.pattern);
    if (match) return translate(candidate.key, candidate.values(match));
  }
  return message;
}
