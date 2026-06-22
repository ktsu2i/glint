import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@base-ui/react/switch";
import {
  ArrowRight,
  Check,
  Eye,
  EyeSlash,
  Key,
  LockKey,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  Translate,
} from "@phosphor-icons/react";
import {
  getLLMSettings,
  saveLLMSettings,
  type LLMSettings,
  type ThemePreference,
} from "../../shared/api/backend";
import { useI18n } from "../../shared/i18n/I18n";

type LLMSettingsPageProps = {
  onBack: () => void;
  theme?: ThemePreference;
  themeLoading?: boolean;
  themeError?: string;
  onThemeChange?: (theme: ThemePreference) => Promise<void>;
};

const themeOptions: Array<{
  value: ThemePreference;
  icon: typeof Sun;
}> = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

export function LLMSettingsPage({
  onBack,
  theme = "system",
  themeLoading = false,
  themeError = "",
  onThemeChange = async () => {},
}: LLMSettingsPageProps) {
  const {
    language,
    loading: languageLoading,
    error: languageError,
    t,
    changeLanguage,
  } = useI18n();
  const translationRef = useRef(t);
  translationRef.current = t;
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [model, setModel] = useState("");
  const [apiKey, setAPIKey] = useState("");
  const [showAPIKey, setShowAPIKey] = useState(false);
  const [zdr, setZDR] = useState(true);
  const [clearAPIKey, setClearAPIKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [localThemeError, setLocalThemeError] = useState("");
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
      setError(reason instanceof Error ? reason.message : translationRef.current("settings.loadError"));
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
    if (!model.trim().includes("/")) {
      setError(t("settings.invalidModel"));
      return;
    }
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
      setError(reason instanceof Error ? reason.message : t("settings.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleThemeChange(next: ThemePreference) {
    if (savingTheme || next === theme) return;
    setSavingTheme(true);
    setLocalThemeError("");
    try {
      await onThemeChange(next);
    } catch (reason) {
      setLocalThemeError(reason instanceof Error ? reason.message : t("error.saveAppearance"));
    } finally {
      setSavingTheme(false);
    }
  }

  async function handleLanguageChange(next: "en" | "ja") {
    if (savingLanguage || languageLoading || next === language) return;
    setSavingLanguage(true);
    try {
      await changeLanguage(next);
    } catch {
      // The provider exposes the persistence error next to these controls.
    } finally {
      setSavingLanguage(false);
    }
  }

  const themeCopy = {
    light: [t("settings.themeLight"), t("settings.themeLightDescription")],
    dark: [t("settings.themeDark"), t("settings.themeDarkDescription")],
    system: [t("settings.themeSystem"), t("settings.themeSystemDescription")],
  } as const;

  const hasCredential = settings?.hasApiKey ?? false;
  const willHaveCredential = apiKey.trim() !== "" || (hasCredential && !clearAPIKey);
  const canSave = !loading && !saving && model.trim() !== "" && (willHaveCredential || clearAPIKey);

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-page-shell">
        <header className="settings-page-heading">
          <div>
            <span className="section-label">{t("settings.section")}</span>
            <h1 id="settings-title">{t("settings.title")}</h1>
            <p>{t("settings.description")}</p>
          </div>
          <div className={settings?.configured ? "settings-connection is-ready" : "settings-connection"}>
            <span className="settings-connection-dot" />
            <div>
              <small>{t("settings.connection")}</small>
              <strong>{loading ? t("settings.checking") : settings?.configured ? t("settings.available") : t("settings.notConfigured")}</strong>
            </div>
          </div>
        </header>

        <div className="settings-layout">
          <nav className="settings-index" aria-label={t("settings.items")}>
            <span>{t("settings.application")}</span>
            <button type="button" className="is-active" aria-current="page">
              <span aria-hidden="true" />
              {t("settings.appearance")}
            </button>
            <button type="button">{t("settings.modelConnection")}</button>
            <p>{t("settings.credentialNote")}</p>
          </nav>

          <form className="settings-page-form" onSubmit={handleSave}>
            <section className="appearance-settings" aria-labelledby="appearance-heading">
              <div className="settings-section-heading">
                <div>
                  <span className="settings-kicker">{t("settings.readingEnvironment")}</span>
                  <h2 id="appearance-heading">{t("settings.appearance")}</h2>
                </div>
                <span className="provider-badge">{t("settings.theme")}</span>
              </div>
              <p className="appearance-description">
                {t("settings.appearanceDescription")}
              </p>
              {(themeError || localThemeError) && (
                <div className="settings-error appearance-error" role="alert">
                  <span>{localThemeError || themeError}</span>
                </div>
              )}
              <div className="theme-options" aria-label={t("settings.themeOptions")}>
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const [label, description] = themeCopy[option.value];
                  const selected = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={selected ? "theme-option is-selected" : "theme-option"}
                      aria-pressed={selected}
                      disabled={themeLoading || savingTheme}
                      onClick={() => void handleThemeChange(option.value)}
                    >
                      <Icon size={18} weight={selected ? "fill" : "regular"} />
                      <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                      </span>
                      <i aria-hidden="true">{selected ? <Check size={12} /> : null}</i>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="settings-form-divider" />

            <section className="appearance-settings" aria-labelledby="language-heading">
              <div className="settings-section-heading">
                <div>
                  <span className="settings-kicker">{t("settings.languageKicker")}</span>
                  <h2 id="language-heading">{t("settings.language")}</h2>
                </div>
                <span className="provider-badge"><Translate size={13} /> {language.toUpperCase()}</span>
              </div>
              <p className="appearance-description">{t("settings.languageDescription")}</p>
              {(languageError || savingLanguage) && (
                <p className={languageError ? "appearance-error" : "language-saving"} role={languageError ? "alert" : "status"}>
                  {languageError || t("settings.languageSaving")}
                </p>
              )}
              <div className="theme-options language-options" aria-label={t("settings.languageOptions")}>
                {([
                  ["en", t("settings.english"), t("settings.englishDescription")],
                  ["ja", t("settings.japanese"), t("settings.japaneseDescription")],
                ] as const).map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    className={language === value ? "theme-option is-selected" : "theme-option"}
                    aria-pressed={language === value}
                    disabled={languageLoading || savingLanguage}
                    onClick={() => void handleLanguageChange(value)}
                  >
                    <span className="language-code" aria-hidden="true">{value.toUpperCase()}</span>
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    <i aria-hidden="true">{language === value ? <Check size={12} /> : null}</i>
                  </button>
                ))}
              </div>
            </section>

            <div className="settings-form-divider" />

            <div className="settings-section-heading">
              <div>
                <span className="settings-kicker">{t("settings.remoteRoute")}</span>
                <h2>{t("settings.openRouterConnection")}</h2>
              </div>
              <span className="provider-badge">OpenRouter</span>
            </div>

            <div className="route-ledger" aria-label={t("settings.sendingRoute")}>
              <span><LockKey size={13} /> Glint</span>
              <ArrowRight size={12} />
              <span>OpenRouter</span>
              <ArrowRight size={12} />
              <span className={zdr ? "route-guard is-active" : "route-guard"}>
                {zdr ? t("settings.zdrEndpoint") : t("settings.providerRoute")}
              </span>
            </div>

            {error && (
              <div className="settings-error" role="alert">
                <span>{error}</span>
                {!settings && !loading && (
                  <button type="button" onClick={() => void loadSettings()}>{t("settings.reload")}</button>
                )}
              </div>
            )}
            {saved && (
              <p className="settings-saved" role="status"><Check size={14} /> {t("settings.saved")}</p>
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
                  placeholder={t("settings.modelPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <small>{t("settings.modelIdHelp")}</small>
              </div>
            </fieldset>

            <fieldset className="settings-fieldset" disabled={loading || saving}>
              <legend>{t("settings.credential")}</legend>
              <div className="settings-field">
                <span className="settings-field-label">
                  <label htmlFor="openrouter-api-key">API key</label>
                  {hasCredential && !clearAPIKey && (
                    <em><Key size={11} /> {t("settings.keyStored")}</em>
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
                    placeholder={clearAPIKey ? t("settings.keyScheduledForRemoval") : hasCredential ? "••••••••••••••••" : "sk-or-v1-…"}
                    autoComplete="new-password"
                    disabled={clearAPIKey}
                    required={!hasCredential}
                  />
                  <button
                    type="button"
                    className="credential-visibility"
                    onClick={() => setShowAPIKey((current) => !current)}
                    disabled={clearAPIKey || apiKey === ""}
                    aria-label={showAPIKey ? t("settings.hideApiKey") : t("settings.showApiKey")}
                  >
                    {showAPIKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <small>
                  {hasCredential && !apiKey && !clearAPIKey
                    ? t("settings.savedKeyHelp")
                    : t("settings.newKeyHelp")}
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
                    {clearAPIKey ? t("settings.keepApiKey") : t("settings.removeApiKey")}
                  </button>
                )}
              </div>
            </fieldset>

            <fieldset className="settings-fieldset" disabled={loading || saving}>
              <legend>{t("settings.privacy")}</legend>
              <div className="privacy-setting">
                <div>
                  <span><ShieldCheck size={16} /> Zero Data Retention</span>
                  <p>{t("settings.zdrDescription")}</p>
                </div>
                <Switch.Root
                  className="context-switch"
                  checked={zdr}
                  onCheckedChange={(checked) => {
                    setZDR(checked);
                    setSaved(false);
                  }}
                  aria-label={t("settings.requireZdr")}
                >
                  <Switch.Thumb className="context-switch-thumb" />
                </Switch.Root>
              </div>
              <p className="remote-data-note">
                {t("settings.remoteDataNote")}
              </p>
            </fieldset>

            <footer className="settings-page-actions">
              <button className="settings-secondary" type="button" onClick={onBack} disabled={saving}>
                {t("settings.back")}
              </button>
              <button className="settings-primary" type="submit" disabled={!canSave}>
                {saving ? t("settings.saving") : t("settings.save")}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </section>
  );
}
