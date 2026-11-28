import { setWindowControlsVisible } from "../api";

export function showWindowControls(visible: boolean) {
  setWindowControlsVisible(visible).catch(() => {});
}
