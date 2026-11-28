import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createInstance, type i18n } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
  getLanguageSettings,
  saveLanguageSettings,
  type LanguagePreference,
} from "../api/settings";
import { onLanguageChanged } from "../api/events";
import { en } from "./locales/en";
import { ja } from "./locales/ja";

type LanguageSettingsValue = {
  language: LanguagePreference;
  loading: boolean;
  error: string;
  changeLanguage: (language: LanguagePreference) => Promise<void>;
};

export const resources = {
  en: { translation: en },
  ja: { translation: ja },
} as const;

function createI18n(language: LanguagePreference) {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: "en",
    supportedLngs: ["en", "ja"],
    defaultNS: "translation",
    keySeparator: false,
    initAsync: false,
    interpolation: {
      escapeValue: false,
      prefix: "{",
      suffix: "}",
    },
    react: { useSuspense: false },
  });
  return instance;
}

const LanguageSettingsContext = createContext<LanguageSettingsValue>({
  language: "en",
  loading: false,
  error: "",
  changeLanguage: async () => {},
});

export function I18nProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: LanguagePreference;
}) {
  const [i18n] = useState<i18n>(() => createI18n(initialLanguage ?? "en"));
  const [language, setLanguage] = useState<LanguagePreference>(initialLanguage ?? "en");
  const [loading, setLoading] = useState(initialLanguage === undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (initialLanguage !== undefined) return;
    let active = true;
    const load = async () => {
      try {
        const settings = await getLanguageSettings();
        if (!active) return;
        await i18n.changeLanguage(settings.language);
        if (!active) return;
        setLanguage(settings.language);
        setError("");
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : i18n.t("error.loadLanguage"));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [i18n, initialLanguage]);

  useEffect(() => {
    if (initialLanguage !== undefined) return;
    return onLanguageChanged((next) => {
      void i18n.changeLanguage(next);
      setLanguage(next);
      setError("");
    });
  }, [i18n, initialLanguage]);

  const changeLanguage = useCallback(
    async (next: LanguagePreference) => {
      if (next === language) return;
      const previous = language;
      setError("");
      try {
        await i18n.changeLanguage(next);
        setLanguage(next);
        const saved = await saveLanguageSettings(next);
        await i18n.changeLanguage(saved.language);
        setLanguage(saved.language);
      } catch (reason) {
        await i18n.changeLanguage(previous);
        setLanguage(previous);
        const message =
          reason instanceof Error
            ? reason.message
            : i18n.t("error.saveLanguage", { lng: previous });
        setError(message);
        throw new Error(message, { cause: reason });
      }
    },
    [i18n, language],
  );

  const value = useMemo<LanguageSettingsValue>(
    () => ({
      language,
      loading,
      error,
      changeLanguage,
    }),
    [changeLanguage, error, language, loading],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <LanguageSettingsContext.Provider value={value}>{children}</LanguageSettingsContext.Provider>
    </I18nextProvider>
  );
}

export function useLanguageSettings() {
  return useContext(LanguageSettingsContext);
}
