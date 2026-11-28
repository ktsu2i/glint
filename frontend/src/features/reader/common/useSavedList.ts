import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TranslationKey } from "../../../shared/i18n/locales/en";

type SavedListOptions<T> = {
  load: (bookId: string) => Promise<T[]>;
  loadErrorKey: TranslationKey;
  onLoaded?: (entries: T[]) => void;
};

export function useSavedList<T>(bookId: string | undefined, options: SavedListOptions<T>) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef({ options, t });
  useEffect(() => {
    latest.current = { options, t };
  });

  const [listedBookId, setListedBookId] = useState(bookId);
  if (listedBookId !== bookId) {
    setListedBookId(bookId);
    setEntries([]);
    setLoaded(false);
    setBusy(false);
    setError("");
  }

  useEffect(() => {
    let active = true;
    if (bookId === undefined) {
      return () => {
        active = false;
      };
    }
    const { options: current, t: translate } = latest.current;
    const load = async () => {
      try {
        const saved = await current.load(bookId);
        if (active) {
          current.onLoaded?.(saved);
          setEntries(saved);
          setLoaded(true);
        }
      } catch (reason: unknown) {
        if (active) {
          setLoaded(true);
          setError(reason instanceof Error ? reason.message : translate(current.loadErrorKey));
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [bookId]);

  const change = useCallback(
    async (action: () => Promise<void>, errorKey: TranslationKey): Promise<boolean> => {
      setBusy(true);
      setError("");
      try {
        await action();
        return true;
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : t(errorKey));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  return { entries, setEntries, loaded, busy, setBusy, error, setError, change };
}
