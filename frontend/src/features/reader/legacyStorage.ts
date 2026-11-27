/**
 * Earlier versions kept some reading state in localStorage. The library keeps
 * it now; these move a value over once and then drop it from localStorage.
 */
export function readLegacyValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function forgetLegacyValue(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

/**
 * Hands a value kept in localStorage to save, and drops it once save succeeds.
 * Returns the value, or null when there was none.
 */
export function moveLegacyValue(key: string, save: (value: string) => Promise<unknown>) {
  const value = readLegacyValue(key);
  if (value === null) {
    return null;
  }
  save(value).then(
    () => forgetLegacyValue(key),
    (reason: unknown) => console.warn("Moving a saved reader setting failed", reason),
  );
  return value;
}
