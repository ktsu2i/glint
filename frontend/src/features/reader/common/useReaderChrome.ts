import { useEffect, useState } from "react";
import { showWindowControls } from "./windowControls";

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
    showWindowControls(windowControlsShown);
  }, [windowControlsShown]);

  useEffect(() => () => showWindowControls(true), []);

  return { chromeShown, setChromeVisible, setTopbarHovered, setTopbarFocused };
}
