import { setWindowControlsVisible } from "../api";

/** Shows or hides the traffic lights along with the reader's bars. */
export function showWindowControls(visible: boolean) {
  // Outside the desktop shell there is no native window to update.
  setWindowControlsVisible(visible).catch(() => {});
}
