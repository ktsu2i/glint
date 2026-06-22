import type { TranslationKey } from "./I18n";

export class LocalizedError extends Error {
  readonly translationKey: TranslationKey;
  readonly values?: Record<string, string | number>;

  constructor(translationKey: TranslationKey, values?: Record<string, string | number>) {
    super(translationKey);
    this.name = "LocalizedError";
    this.translationKey = translationKey;
    this.values = values;
  }
}

const backendErrorKeys: Record<string, TranslationKey> = {
  "応答に時間がかかりすぎたため、質問を打ち切りました。": "chat.timeout",
  "OpenRouterから不正なstream応答を受信しました。": "chat.invalidStream",
  "OpenRouterのstream接続が中断されました。": "chat.streamInterrupted",
  "OpenRouterのstreamが完了通知なしで終了しました。": "chat.streamIncomplete",
  "OpenRouter API keyを確認してください。": "chat.invalidApiKey",
  "OpenRouterのcredit残高を確認してください。": "chat.insufficientCredit",
  "OpenRouterのrate limitに達しました。少し待ってから再試行してください。": "chat.rateLimit",
  "OpenRouterのmodelを設定してください。": "chat.modelMissing",
  "OpenRouter API keyを設定してください。": "chat.apiKeyMissing",
};

export function localizeBackendError(
  message: string,
  translate: (key: TranslationKey) => string,
) {
  const key = backendErrorKeys[message];
  return key ? translate(key) : message;
}
