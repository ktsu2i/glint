import { useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { syncDocumentTheme } from "../features/settings/theme";
import { onAppearanceChanged } from "../shared/api/events";
import { getAppearanceSettings, type ThemePreference } from "../shared/api/settings";

/** Applies the saved theme to the main window and follows the settings window. */
export function useAppTheme() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemePreference>("system");

  useLayoutEffect(() => syncDocumentTheme(theme), [theme]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const loaded = await getAppearanceSettings();
        if (active) setTheme(loaded.theme);
      } catch (reason) {
        console.warn(reason instanceof Error ? reason.message : t("error.loadAppearance"));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [t]);

  // The settings window saves the theme; follow it here as well.
  useEffect(() => onAppearanceChanged(setTheme), []);
}
