import { useEffect, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { View } from "foliate-js/view.js";
import { createUtterance, type useReadAloud } from "../common/speech";
import { rangeSpeechText } from "./epubContent";

export function useEpubReadAloud({
  readAloud: { supported, voices, active, setActive },
  view,
  pageCFI,
  pageRangeRef,
}: {
  readAloud: ReturnType<typeof useReadAloud>;
  view: View | null;
  pageCFI: string;
  pageRangeRef: RefObject<Range | null>;
}) {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!supported || !active || !view || !pageCFI) {
      return;
    }
    let cancelled = false;
    const synth = window.speechSynthesis;
    const readOn = () => {
      if (cancelled) {
        return;
      }
      if (view.renderer?.atEnd === true) {
        setActive(false);
        return;
      }
      view.next().catch(() => setActive(false));
    };
    const range = pageRangeRef.current;
    const text = range ? rangeSpeechText(range) : "";
    if (!text) {
      readOn();
      return () => {
        cancelled = true;
      };
    }
    const utterance = createUtterance(text, i18n.language, voices);
    utterance.addEventListener("end", readOn);
    utterance.addEventListener("error", () => {
      if (!cancelled) {
        setActive(false);
      }
    });
    synth.cancel();
    synth.speak(utterance);
    return () => {
      // Cancelling ends the utterance, which must not turn the page.
      cancelled = true;
      synth.cancel();
    };
  }, [active, i18n.language, pageCFI, pageRangeRef, setActive, supported, view, voices]);
}
