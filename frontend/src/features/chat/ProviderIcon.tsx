import {
  Brain,
  Circle,
  Cube,
  Eye,
  Hexagon,
  Sparkle,
  Terminal,
} from "@phosphor-icons/react";

type ProviderIconProps = {
  providerId: string;
  displayLabel?: string;
  size?: number;
};

const OPENAI_COMPATIBLE_PREFIX = "openai_compatible:";

function customGlyph(displayLabel: string, providerId: string): string {
  const source = displayLabel.trim() || providerId.replace(OPENAI_COMPATIBLE_PREFIX, "").trim();
  if (!source) return "·";
  return source[0]!.toUpperCase();
}

// ProviderIcon renders a monochrome glyph for a provider so the composer's
// model selector can identify the route without using brand colors. Built-in
// providers map to a phosphor icon; custom OpenAI-compatible providers fall
// back to a neutral letter glyph derived from the display label.
export function ProviderIcon({ providerId, displayLabel = "", size = 12 }: ProviderIconProps) {
  if (providerId.startsWith(OPENAI_COMPATIBLE_PREFIX)) {
    return (
      <span
        className="provider-icon provider-icon-letter"
        aria-hidden="true"
        style={{ width: size, height: size, fontSize: Math.max(size - 4, 8) }}
      >
        {customGlyph(displayLabel, providerId)}
      </span>
    );
  }
  const iconProps = { size, weight: "regular" as const };
  switch (providerId) {
    case "openai":
      return <Sparkle {...iconProps} aria-hidden="true" />;
    case "anthropic":
      return <Hexagon {...iconProps} aria-hidden="true" />;
    case "google":
      return <Cube {...iconProps} aria-hidden="true" />;
    case "openrouter":
      return <Brain {...iconProps} aria-hidden="true" />;
    case "ollama":
      return <Terminal {...iconProps} aria-hidden="true" />;
    case "openai_compatible":
      return <Eye {...iconProps} aria-hidden="true" />;
    default:
      return <Circle {...iconProps} aria-hidden="true" />;
  }
}
