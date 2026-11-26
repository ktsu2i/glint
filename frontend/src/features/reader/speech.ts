import { useEffect, useState } from "react";

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** The voices the system offers; they can arrive after the page loads. */
export function useSpeechVoices(supported: boolean): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!supported) {
      return;
    }
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      synth.removeEventListener("voiceschanged", load);
    };
  }, [supported]);
  return voices;
}

export function detectUtteranceLang(text: string, fallbackUiLang: string): string {
  if (/[぀-ゟ゠-ヿ一-鿿]/.test(text)) {
    return "ja-JP";
  }
  return fallbackUiLang === "ja" ? "ja-JP" : "en-US";
}

export function pickVoiceForLang(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) {
    return null;
  }
  const target = lang.toLowerCase();
  const prefix = target.slice(0, 2);
  const exact = voices.find((voice) => voice.lang.toLowerCase() === target);
  if (exact) {
    return exact;
  }
  const sameLanguage = voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
  return sameLanguage ?? null;
}
