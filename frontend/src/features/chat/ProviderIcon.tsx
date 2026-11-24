import {
  BrainIcon,
  CircleIcon,
  CubeIcon,
  EyeIcon,
  HexagonIcon,
  SparkleIcon,
  TerminalIcon,
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
  return source.charAt(0).toUpperCase();
}

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
      return <SparkleIcon {...iconProps} aria-hidden="true" />;
    case "anthropic":
      return <HexagonIcon {...iconProps} aria-hidden="true" />;
    case "google":
      return <CubeIcon {...iconProps} aria-hidden="true" />;
    case "openrouter":
      return <BrainIcon {...iconProps} aria-hidden="true" />;
    case "ollama":
      return <TerminalIcon {...iconProps} aria-hidden="true" />;
    case "openai_compatible":
      return <EyeIcon {...iconProps} aria-hidden="true" />;
    default:
      return <CircleIcon {...iconProps} aria-hidden="true" />;
  }
}
