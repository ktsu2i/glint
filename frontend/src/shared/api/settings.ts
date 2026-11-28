import {
  GetAppearanceSettings,
  GetLanguageSettings,
  SaveAppearanceSettings,
  SaveLanguageSettings,
} from "../../../bindings/github.com/ktsu2i/glint/internal/app/settingsservice";

// Appearance and language apply to every window, so they live here rather
// than in a feature.

export type ThemePreference = "light" | "dark" | "system";

type AppearanceSettings = {
  theme: ThemePreference;
};

export type LanguagePreference = "en" | "ja";

type LanguageSettings = {
  language: LanguagePreference;
};

export async function getAppearanceSettings(): Promise<AppearanceSettings> {
  return (await GetAppearanceSettings()) as AppearanceSettings;
}

export async function saveAppearanceSettings(theme: ThemePreference): Promise<AppearanceSettings> {
  return (await SaveAppearanceSettings({ theme })) as AppearanceSettings;
}

export async function getLanguageSettings(): Promise<LanguageSettings> {
  return (await GetLanguageSettings()) as LanguageSettings;
}

export async function saveLanguageSettings(
  language: LanguagePreference,
): Promise<LanguageSettings> {
  return (await SaveLanguageSettings({ language })) as LanguageSettings;
}
