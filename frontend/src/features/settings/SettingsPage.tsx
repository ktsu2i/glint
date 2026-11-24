import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon, TranslateIcon } from "@phosphor-icons/react";
import type { ThemePreference } from "../../shared/api/backend";
import { useLanguageSettings } from "../../shared/i18n/i18n";

type SettingsPageProps = {
  onBack: () => void;
  theme?: ThemePreference;
  themeLoading?: boolean;
  themeError?: string;
  onThemeChange?: (theme: ThemePreference) => Promise<void>;
};

const themeOptions: Array<{
  value: ThemePreference;
  icon: typeof SunIcon;
}> = [
  { value: "light", icon: SunIcon },
  { value: "dark", icon: MoonIcon },
  { value: "system", icon: MonitorIcon },
];

function extractErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string" && reason.trim() !== "") return reason;
  return fallback;
}

async function noopThemeChange(): Promise<void> {}

export function SettingsPage({
  onBack,
  theme = "system",
  themeLoading = false,
  themeError = "",
  onThemeChange = noopThemeChange,
}: SettingsPageProps) {
  const { t } = useTranslation();
  const {
    language,
    loading: languageLoading,
    error: languageError,
    changeLanguage,
  } = useLanguageSettings();
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [localThemeError, setLocalThemeError] = useState("");

  async function handleThemeChange(next: ThemePreference) {
    if (savingTheme || next === theme) return;
    setSavingTheme(true);
    setLocalThemeError("");
    try {
      await onThemeChange(next);
    } catch (reason) {
      setLocalThemeError(extractErrorMessage(reason, t("error.saveAppearance")));
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
    } finally {
      setSavingLanguage(false);
    }
  }

  const themeCopy = {
    light: [t("settings.themeLight"), t("settings.themeLightDescription")],
    dark: [t("settings.themeDark"), t("settings.themeDarkDescription")],
    system: [t("settings.themeSystem"), t("settings.themeSystemDescription")],
  } as const;

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-page-shell">
        <header className="settings-page-heading">
          <div>
            <span className="section-label">{t("settings.section")}</span>
            <h1 id="settings-title">{t("settings.title")}</h1>
            <p>{t("settings.description")}</p>
          </div>
        </header>

        <div className="settings-layout">
          <nav className="settings-index" aria-label={t("settings.items")}>
            <span>{t("settings.application")}</span>
            <button type="button" className="is-active" aria-current="page">
              <span aria-hidden="true" />
              {t("settings.appearance")}
            </button>
          </nav>

          <div className="settings-page-form">
            <section className="appearance-settings" aria-labelledby="appearance-heading">
              <div className="settings-section-heading">
                <div>
                  <span className="settings-kicker">{t("settings.readingEnvironment")}</span>
                  <h2 id="appearance-heading">{t("settings.appearance")}</h2>
                </div>
                <span className="provider-badge">{t("settings.theme")}</span>
              </div>
              <p className="appearance-description">{t("settings.appearanceDescription")}</p>
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
                      <i aria-hidden="true">{selected ? <CheckIcon size={12} /> : null}</i>
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
                <span className="provider-badge">
                  <TranslateIcon size={13} /> {language.toUpperCase()}
                </span>
              </div>
              <p className="appearance-description">{t("settings.languageDescription")}</p>
              {(languageError || savingLanguage) && (
                <p
                  className={languageError ? "appearance-error" : "language-saving"}
                  role={languageError ? "alert" : "status"}
                >
                  {languageError || t("settings.languageSaving")}
                </p>
              )}
              <div
                className="theme-options language-options"
                aria-label={t("settings.languageOptions")}
              >
                {(
                  [
                    ["en", t("settings.english"), t("settings.englishDescription")],
                    ["ja", t("settings.japanese"), t("settings.japaneseDescription")],
                  ] as const
                ).map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    className={language === value ? "theme-option is-selected" : "theme-option"}
                    aria-pressed={language === value}
                    disabled={languageLoading || savingLanguage}
                    onClick={() => void handleLanguageChange(value)}
                  >
                    <span className="language-code" aria-hidden="true">
                      {value.toUpperCase()}
                    </span>
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    <i aria-hidden="true">{language === value ? <CheckIcon size={12} /> : null}</i>
                  </button>
                ))}
              </div>
            </section>

            <footer className="settings-page-actions">
              <button className="settings-secondary" type="button" onClick={onBack}>
                {t("settings.back")}
              </button>
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
}
