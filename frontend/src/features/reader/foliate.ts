import type { View } from "foliate-js/view.js";

/**
 * Loads foliate-js on first use, so the library stays out of the bundle that
 * opens the app, and creates its view element.
 */
export async function createFoliateView(): Promise<View> {
  const { View: FoliateView } = await import("foliate-js/view.js");
  return new FoliateView();
}
