import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TranslationKey } from "../../../shared/i18n/locales/en";

type SavedListOptions<T> = {
  load: (bookId: string) => Promise<T[]>;
  /** Shown when loading fails without a message of its own. */
  loadErrorKey: TranslationKey;
  /** Runs with the loaded entries before they are stored. */
  onLoaded?: (entries: T[]) => void;
};

/**
 * Entries saved for a book, such as bookmarks or highlights. They load again
 * when the book changes. busy and error cover changes made to them.
 */
export function useSavedList<T>(bookId: string | undefined, options: SavedListOptions<T>) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Only a new book reloads the list, so the rest is read through a ref.
  const latest = useRef({ options, t });
  useEffect(() => {
    latest.current = { options, t };
  });

  useEffect(() => {
    let active = true;
    // oxlint-disable-next-line react/set-state-in-effect -- 本が変わったら前の本の一覧を消してから読み直す。
    setEntries([]);
    setLoaded(false);
    setBusy(false);
    setError("");
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

  /**
   * Runs a change to the entries while marking the list busy, and reports
   * whether it worked. A failure shows its message, or the text of errorKey.
   */
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
