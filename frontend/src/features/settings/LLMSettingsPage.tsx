import { FormEvent, useCallback, useEffect, useState } from "react";
import { Switch } from "@base-ui/react/switch";
import {
  ArrowRight,
  Check,
  Eye,
  EyeSlash,
  Key,
  LockKey,
  ShieldCheck,
} from "@phosphor-icons/react";
import {
  getLLMSettings,
  saveLLMSettings,
  type LLMSettings,
} from "../../shared/api/backend";

type LLMSettingsPageProps = {
  onBack: () => void;
};

export function LLMSettingsPage({ onBack }: LLMSettingsPageProps) {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [model, setModel] = useState("");
  const [apiKey, setAPIKey] = useState("");
  const [showAPIKey, setShowAPIKey] = useState(false);
  const [zdr, setZDR] = useState(true);
  const [clearAPIKey, setClearAPIKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await getLLMSettings();
      setSettings(loaded);
      setModel(loaded.model);
      setZDR(loaded.zdr);
      setAPIKey("");
      setClearAPIKey(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "LLM設定を読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const next = await saveLLMSettings({
        model: model.trim(),
        apiKey: apiKey.trim(),
        zdr,
        clearApiKey: clearAPIKey,
      });
      setSettings(next);
      setModel(next.model);
      setZDR(next.zdr);
      setAPIKey("");
      setShowAPIKey(false);
      setClearAPIKey(false);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "OpenRouter設定を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  const hasCredential = settings?.hasApiKey ?? false;
  const willHaveCredential = apiKey.trim() !== "" || (hasCredential && !clearAPIKey);
  const canSave = !loading && !saving && model.trim() !== "" && (willHaveCredential || clearAPIKey);

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-page-shell">
        <header className="settings-page-heading">
          <div>
            <span className="section-label">Application settings</span>
            <h1 id="settings-title">設定</h1>
            <p>AIへの接続先と、読書contextを送るときのprivacy制約を管理します。</p>
          </div>
          <div className={settings?.configured ? "settings-connection is-ready" : "settings-connection"}>
            <span className="settings-connection-dot" />
            <div>
              <small>Connection</small>
              <strong>{loading ? "確認中" : settings?.configured ? "利用可能" : "未設定"}</strong>
            </div>
          </div>
        </header>

        <div className="settings-layout">
          <nav className="settings-index" aria-label="設定項目">
            <span>AI</span>
            <button type="button" className="is-active" aria-current="page">
              <span aria-hidden="true" />
              Model connection
            </button>
            <p>API keyはOSのcredential storeに分離して保存します。</p>
          </nav>

          <form className="settings-page-form" onSubmit={handleSave}>
            <div className="settings-section-heading">
              <div>
                <span className="settings-kicker">Remote model route</span>
                <h2>OpenRouter 接続</h2>
              </div>
              <span className="provider-badge">OpenRouter</span>
            </div>

            <div className="route-ledger" aria-label="送信経路">
              <span><LockKey size={13} /> Glint</span>
              <ArrowRight size={12} />
              <span>OpenRouter</span>
              <ArrowRight size={12} />
              <span className={zdr ? "route-guard is-active" : "route-guard"}>
                {zdr ? "ZDR endpoint" : "Provider route"}
              </span>
            </div>

            {error && (
              <div className="settings-error" role="alert">
                <span>{error}</span>
                {!settings && !loading && (
                  <button type="button" onClick={() => void loadSettings()}>再読み込み</button>
                )}
              </div>
            )}
            {saved && (
              <p className="settings-saved" role="status"><Check size={14} /> 設定を保存しました。</p>
            )}

            <fieldset className="settings-fieldset" disabled={loading || saving}>
              <legend>Model</legend>
              <div className="settings-field">
                <label htmlFor="openrouter-model">Model ID</label>
                <input
                  id="openrouter-model"
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value);
                    setSaved(false);
                  }}
                  placeholder="例: anthropic/claude-sonnet-4"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <small>OpenRouterの <code>provider/model</code> 形式のIDを入力します。</small>
              </div>
            </fieldset>

            <fieldset className="settings-fieldset" disabled={loading || saving}>
              <legend>Credential</legend>
              <div className="settings-field">
                <span className="settings-field-label">
                  <label htmlFor="openrouter-api-key">API key</label>
                  {hasCredential && !clearAPIKey && (
                    <em><Key size={11} /> OS credential storeに保存済み</em>
                  )}
                </span>
                <div className="credential-input">
                  <input
                    id="openrouter-api-key"
                    className={hasCredential && !apiKey ? "has-saved-credential" : ""}
                    type={showAPIKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => {
                      setAPIKey(event.target.value);
                      if (event.target.value) setClearAPIKey(false);
                      setSaved(false);
                    }}
                    placeholder={clearAPIKey ? "削除予定" : hasCredential ? "••••••••••••••••" : "sk-or-v1-…"}
                    autoComplete="new-password"
                    disabled={clearAPIKey}
                    required={!hasCredential}
                  />
                  <button
                    type="button"
                    className="credential-visibility"
                    onClick={() => setShowAPIKey((current) => !current)}
                    disabled={clearAPIKey || apiKey === ""}
                    aria-label={showAPIKey ? "API keyを隠す" : "API keyを表示"}
                  >
                    {showAPIKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <small>
                  {hasCredential && !apiKey && !clearAPIKey
                    ? "保存済みです。実際の値は読み戻さず、マスク表示しています。"
                    : "保存後、API keyの値をGlintの画面へ読み戻すことはありません。"}
                </small>
                {hasCredential && (
                  <button
                    type="button"
                    className={clearAPIKey ? "credential-action is-pending" : "credential-action"}
                    onClick={() => {
                      setClearAPIKey((current) => !current);
                      setAPIKey("");
                      setShowAPIKey(false);
                      setSaved(false);
                    }}
                  >
                    {clearAPIKey ? "API keyを保持する" : "保存済みAPI keyを削除"}
                  </button>
                )}
              </div>
            </fieldset>

            <fieldset className="settings-fieldset" disabled={loading || saving}>
              <legend>Privacy</legend>
              <div className="privacy-setting">
                <div>
                  <span><ShieldCheck size={16} /> Zero Data Retention</span>
                  <p>データを保持しないendpointだけにroutingを制限します。</p>
                </div>
                <Switch.Root
                  className="context-switch"
                  checked={zdr}
                  onCheckedChange={(checked) => {
                    setZDR(checked);
                    setSaved(false);
                  }}
                  aria-label="Zero Data Retentionを必須にする"
                >
                  <Switch.Thumb className="context-switch-thumb" />
                </Switch.Root>
              </div>
              <p className="remote-data-note">
                質問と明示的に添付したPDF contextは、OpenRouterと選択されたmodel providerへ送信されます。
              </p>
            </fieldset>

            <footer className="settings-page-actions">
              <button className="settings-secondary" type="button" onClick={onBack} disabled={saving}>
                戻る
              </button>
              <button className="settings-primary" type="submit" disabled={!canSave}>
                {saving ? "保存しています…" : "設定を保存"}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </section>
  );
}
