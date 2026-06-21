import { FormEvent, useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import {
  ArrowRight,
  GearSix,
  Key,
  LockKey,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import {
  saveLLMSettings,
  type LLMSettings,
} from "../../shared/api/backend";

type LLMSettingsDialogProps = {
  settings: LLMSettings | null;
  loadError?: string;
  onSaved: (settings: LLMSettings) => void;
};

export function LLMSettingsDialog({
  settings,
  loadError = "",
  onSaved,
}: LLMSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState("");
  const [apiKey, setAPIKey] = useState("");
  const [zdr, setZDR] = useState(true);
  const [clearAPIKey, setClearAPIKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setModel(settings?.model ?? "");
    setAPIKey("");
    setZDR(settings?.zdr ?? true);
    setClearAPIKey(false);
    setError("");
  }, [open, settings]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await saveLLMSettings({
        model: model.trim(),
        apiKey: apiKey.trim(),
        zdr,
        clearApiKey: clearAPIKey,
      });
      onSaved(saved);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "OpenRouter設定を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  const configured = settings?.configured ?? false;
  const statusLabel = settings === null
    ? "確認中"
    : configured
      ? "OpenRouter"
      : "設定する";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={`provider-status-button ${configured ? "is-connected" : ""}`}
        aria-label="LLM接続設定を開く"
      >
        <span className="provider-status-dot" />
        <span>{statusLabel}</span>
        <GearSix size={12} aria-hidden="true" />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="settings-backdrop" />
        <Dialog.Viewport className="settings-viewport">
          <Dialog.Popup className="settings-dialog">
            <header className="settings-dialog-header">
              <div>
                <span className="settings-kicker">Remote model route</span>
                <Dialog.Title>OpenRouter 接続</Dialog.Title>
                <Dialog.Description>
                  読書contextを送るモデルとprivacy制約を設定します。
                </Dialog.Description>
              </div>
              <Dialog.Close className="settings-close" aria-label="設定を閉じる">
                <X size={16} />
              </Dialog.Close>
            </header>

            <div className="route-ledger" aria-label="送信経路">
              <span><LockKey size={13} /> Glint</span>
              <ArrowRight size={12} />
              <span>OpenRouter</span>
              <ArrowRight size={12} />
              <span className={zdr ? "route-guard is-active" : "route-guard"}>
                {zdr ? "ZDR endpoint" : "Provider route"}
              </span>
            </div>

            <form className="settings-form" onSubmit={handleSave}>
              {loadError && <p className="settings-error" role="alert">{loadError}</p>}
              {error && <p className="settings-error" role="alert">{error}</p>}

              <div className="settings-field">
                <label htmlFor="openrouter-model">Model</label>
                <input
                  id="openrouter-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="例: anthropic/claude-sonnet-4"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <small>OpenRouterの provider/model 形式のIDを指定します。</small>
              </div>

              <div className="settings-field">
                <span className="settings-field-label">
                  <label htmlFor="openrouter-api-key">API key</label>
                  {settings?.hasApiKey && !clearAPIKey && (
                    <em><Key size={10} /> OS credential storeに保存済み</em>
                  )}
                </span>
                <input
                  id="openrouter-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    setAPIKey(event.target.value);
                    if (event.target.value) setClearAPIKey(false);
                  }}
                  placeholder={settings?.hasApiKey ? "変更する場合のみ入力" : "sk-or-v1-…"}
                  autoComplete="new-password"
                  disabled={clearAPIKey}
                  required={!settings?.hasApiKey}
                />
                {settings?.hasApiKey && (
                  <button
                    type="button"
                    className={clearAPIKey ? "credential-action is-pending" : "credential-action"}
                    onClick={() => {
                      setClearAPIKey((current) => !current);
                      setAPIKey("");
                    }}
                  >
                    {clearAPIKey ? "API keyを保持する" : "保存済みAPI keyを削除"}
                  </button>
                )}
              </div>

              <div className="privacy-setting">
                <div>
                  <span><ShieldCheck size={15} /> Zero Data Retention</span>
                  <p>保存しないendpointだけにroutingを制限します。</p>
                </div>
                <Switch.Root
                  className="context-switch"
                  checked={zdr}
                  onCheckedChange={setZDR}
                  aria-label="Zero Data Retentionを必須にする"
                >
                  <Switch.Thumb className="context-switch-thumb" />
                </Switch.Root>
              </div>

              <p className="remote-data-note">
                質問と添付したPDF contextは、OpenRouterと選択されたmodel providerへ送信されます。
              </p>

              <footer className="settings-actions">
                <Dialog.Close className="settings-secondary" disabled={saving}>キャンセル</Dialog.Close>
                <button
                  className="settings-primary"
                  type="submit"
                  disabled={saving || !model.trim() || (!settings?.hasApiKey && !apiKey.trim())}
                >
                  {saving ? "保存しています…" : "設定を保存"}
                </button>
              </footer>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
