import type { ThemePreference } from "../../shared/api/backend";

export const SYSTEM_DARK_THEME_QUERY = "(prefers-color-scheme: dark)";

export function syncDocumentTheme(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
  mediaQuery: MediaQueryList = window.matchMedia(SYSTEM_DARK_THEME_QUERY),
): () => void {
  const apply = () => {
    const resolved = preference === "system"
      ? mediaQuery.matches ? "dark" : "light"
      : preference;
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolved;
  };

  apply();
  if (preference === "system") {
    mediaQuery.addEventListener("change", apply);
  }

  return () => {
    if (preference === "system") {
      mediaQuery.removeEventListener("change", apply);
    }
  };
}
