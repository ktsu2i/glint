import { useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, PaletteIcon, TranslateIcon } from "@phosphor-icons/react";
import {
  getAppearanceSettings,
  saveAppearanceSettings,
  type LanguagePreference,
  type ThemePreference,
} from "../../shared/api/backend";
import { onAppearanceChanged } from "../../shared/api/events";
import { I18nProvider, useLanguageSettings } from "../../shared/i18n/i18n";
import { syncDocumentTheme } from "./theme";

type SettingsTab = "appearance" | "language";

const themeOptions: ThemePreference[] = ["light", "dark", "system"];
const languageOptions: LanguagePreference[] = ["en", "ja"];

function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string" && reason.trim() !== "") return reason;
  return fallback;
}

// SettingsWindow is the content of the separate window opened with Command-comma.
export function SettingsWindow() {
  const { t } = useTranslation();
  const {
    language,
    loading: languageLoading,
    error: languageError,
    changeLanguage,
  } = useLanguageSettings();
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [themeLoading, setThemeLoading] = useState(true);
  const [themeError, setThemeError] = useState("");
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);

  useLayoutEffect(() => syncDocumentTheme(theme), [theme]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const loaded = await getAppearanceSettings();
        if (active) setTheme(loaded.theme);
      } catch (reason) {
        if (active) setThemeError(errorMessage(reason, t("error.loadAppearance")));
      } finally {
        if (active) setThemeLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => onAppearanceChanged(setTheme), []);

  async function handleThemeChange(next: ThemePreference) {
    if (savingTheme || next === theme) return;
    const previous = theme;
    setTheme(next);
    setThemeError("");
    setSavingTheme(true);
    try {
      const saved = await saveAppearanceSettings(next);
      setTheme(saved.theme);
    } catch (reason) {
      setTheme(previous);
      setThemeError(errorMessage(reason, t("error.saveAppearance")));
    } finally {
      setSavingTheme(false);
    }
  }

  async function handleLanguageChange(next: LanguagePreference) {
    if (savingLanguage || languageLoading || next === language) return;
    setSavingLanguage(true);
    try {
      await changeLanguage(next);
    } catch {
      // useLanguageSettings keeps the error to show it below.
    } finally {
      setSavingLanguage(false);
    }
  }

  const themeCopy: Record<ThemePreference, [string, string]> = {
    light: [t("settings.themeLight"), t("settings.themeLightDescription")],
    dark: [t("settings.themeDark"), t("settings.themeDarkDescription")],
    system: [t("settings.themeSystem"), t("settings.themeSystemDescription")],
  };
  const languageCopy: Record<LanguagePreference, [string, string]> = {
    en: [t("settings.english"), t("settings.englishDescription")],
    ja: [t("settings.japanese"), t("settings.japaneseDescription")],
  };
  const tabs: Array<{ id: SettingsTab; label: string; icon: typeof PaletteIcon }> = [
    { id: "appearance", label: t("settings.appearance"), icon: PaletteIcon },
    { id: "language", label: t("settings.language"), icon: TranslateIcon },
  ];
  const activeLabel = tab === "appearance" ? t("settings.appearance") : t("settings.language");

  return (
    <main className="settings-window ambient">
      <header className="settings-window-header">
        <h1>{activeLabel}</h1>
        <div className="settings-tabs" role="tablist" aria-label={t("settings.items")}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`settings-panel-${id}`}
              onClick={() => setTab(id)}
            >
              <Icon size={22} weight={tab === id ? "fill" : "regular"} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </header>

      {tab === "appearance" ? (
        <section
          className="settings-panel"
          role="tabpanel"
          id="settings-panel-appearance"
          aria-labelledby="settings-tab-appearance"
        >
          <div className="settings-panel-heading">
            <h2>{t("settings.themeOptions")}</h2>
            <p>{t("settings.appearanceDescription")}</p>
          </div>
          {themeError && (
            <p className="settings-error" role="alert">
              {themeError}
            </p>
          )}
          <div
            className="settings-theme-options"
            role="group"
            aria-label={t("settings.themeOptions")}
          >
            {themeOptions.map((option) => {
              const [label, description] = themeCopy[option];
              const selected = theme === option;
              return (
                <button
                  key={option}
                  type="button"
                  className={`settings-theme-option is-${option}`}
                  aria-label={label}
                  aria-describedby={`settings-theme-${option}-description`}
                  aria-pressed={selected}
                  disabled={themeLoading || savingTheme}
                  onClick={() => void handleThemeChange(option)}
                >
                  <span className="settings-theme-preview" aria-hidden="true">
                    <span />
                    <span />
                  </span>
                  <span className="settings-option-copy" aria-hidden="true">
                    <strong>{label}</strong>
                    <small id={`settings-theme-${option}-description`}>{description}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section
          className="settings-panel"
          role="tabpanel"
          id="settings-panel-language"
          aria-labelledby="settings-tab-language"
        >
          <div className="settings-panel-heading">
            <h2>{t("settings.languageOptions")}</h2>
            <p>{t("settings.languageDescription")}</p>
          </div>
          {(languageError || savingLanguage) && (
            <p
              className={languageError ? "settings-error" : "settings-saving"}
              role={languageError ? "alert" : "status"}
            >
              {languageError || t("settings.languageSaving")}
            </p>
          )}
          <div
            className="settings-language-options"
            role="group"
            aria-label={t("settings.languageOptions")}
          >
            {languageOptions.map((option) => {
              const [label, description] = languageCopy[option];
              const selected = language === option;
              return (
                <button
                  key={option}
                  type="button"
                  className="settings-language-option"
                  aria-pressed={selected}
                  disabled={languageLoading || savingLanguage}
                  onClick={() => void handleLanguageChange(option)}
                >
                  <span className="settings-check" aria-hidden="true">
                    {selected ? <CheckIcon size={11} weight="bold" /> : null}
                  </span>
                  <span className="settings-option-copy">
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

export function SettingsWindowApp() {
  return (
    <I18nProvider>
      <SettingsWindow />
    </I18nProvider>
  );
}
