import { Events } from "@wailsio/runtime";
import type { LanguagePreference, ThemePreference } from "./settings";

// The backend pushes these events to every window after a setting is saved,
// so the main window follows changes made in the settings window.
const appearanceChangedEvent = "settings:appearance-changed";
const languageChangedEvent = "settings:language-changed";

function isTheme(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function isLanguage(value: unknown): value is LanguagePreference {
  return value === "en" || value === "ja";
}

function field(data: unknown, key: string): unknown {
  if (typeof data !== "object" || data === null || !(key in data)) {
    return undefined;
  }
  return Reflect.get(data, key) as unknown;
}

export function onAppearanceChanged(callback: (theme: ThemePreference) => void): () => void {
  return Events.On(appearanceChangedEvent, (event) => {
    const theme = field(event.data, "theme");
    if (isTheme(theme)) {
      callback(theme);
    }
  });
}

export function onLanguageChanged(callback: (language: LanguagePreference) => void): () => void {
  return Events.On(languageChangedEvent, (event) => {
    const language = field(event.data, "language");
    if (isLanguage(language)) {
      callback(language);
    }
  });
}
