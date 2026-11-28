import { useEffect, useState } from "react";
import { showWindowControls } from "./windowControls";

/**
 * Whether the reader's bars are shown. They stay while a panel or menu is
 * open. The top bar also appears on hover and focus, and the traffic lights
 * sit inside it, so they follow the bar rather than the chrome alone.
 */
export function useReaderChrome({
  panelOpen,
  forceWindowControls = false,
}: {
  panelOpen: boolean;
  forceWindowControls?: boolean;
}) {
  const [chromeVisible, setChromeVisible] = useState(true);
  const [topbarHovered, setTopbarHovered] = useState(false);
  const [topbarFocused, setTopbarFocused] = useState(false);
  const chromeShown = chromeVisible || panelOpen;
  const windowControlsShown = forceWindowControls || chromeShown || topbarHovered || topbarFocused;

  useEffect(() => {
    // The native buttons fade over the same duration as the toolbars.
    showWindowControls(windowControlsShown);
  }, [windowControlsShown]);

  useEffect(() => () => showWindowControls(true), []);

  return { chromeShown, setChromeVisible, setTopbarHovered, setTopbarFocused };
}
