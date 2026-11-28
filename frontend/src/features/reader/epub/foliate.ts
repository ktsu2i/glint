import type { View } from "foliate-js/view.js";

export type HighlightDrawer = (rects: DOMRectList, options: { color: string }) => SVGElement;

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
