import type { View } from "foliate-js/view.js";

export type HighlightDrawer = (rects: DOMRectList, options: { color: string }) => SVGElement;

/**
 * Loads foliate-js on first use, so the library stays out of the bundle that
 * opens the app, and creates its view element with the highlight drawer.
 */
export async function createFoliateView(): Promise<{ view: View; drawHighlight: HighlightDrawer }> {
  const [{ View: FoliateView }, { Overlayer }] = await Promise.all([
    import("foliate-js/view.js"),
    import("foliate-js/overlayer.js"),
  ]);
  return {
    view: new FoliateView(),
    drawHighlight: (rects, options) => Overlayer.highlight(rects, options),
  };
}
