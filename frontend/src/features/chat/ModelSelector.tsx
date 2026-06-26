import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CaretDown, Check, GearSix } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { LLMConfig, ProviderSettings } from "../../shared/api/backend";
import { ProviderIcon } from "./ProviderIcon";

type ModelSelectorProps = {
  config: LLMConfig | null;
  switching: boolean;
  onSelect: (providerId: string) => void | Promise<void>;
  onOpenSettings: () => void;
};

type SelectableProvider = {
  providerId: string;
  displayLabel: string;
  model: string;
  isActive: boolean;
};

function buildProviderLabel(config: LLMConfig | null, provider: ProviderSettings): string {
  if (provider.displayLabel) return provider.displayLabel;
  const descriptor = config?.catalog.find((entry) => entry.id === provider.providerId);
  return descriptor?.displayName ?? provider.providerId;
}

function selectableProviders(config: LLMConfig | null): SelectableProvider[] {
  if (!config) return [];
  return config.providers
    .filter((provider) => provider.configured && provider.model.trim() !== "")
    .map((provider) => ({
      providerId: provider.providerId,
      displayLabel: buildProviderLabel(config, provider),
      model: provider.model,
      isActive: provider.providerId === config.activeProviderId,
    }));
}

type Section = {
  key: string;
  label: string;
  items: SelectableProvider[];
};

function buildSections(items: SelectableProvider[], recent: string[], query: string): Section[] {
  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed
    ? items.filter((item) =>
      item.providerId.toLowerCase().includes(trimmed)
        || item.displayLabel.toLowerCase().includes(trimmed)
        || item.model.toLowerCase().includes(trimmed))
    : items;
  if (filtered.length === 0) return [];

  const byId = new Map(filtered.map((item) => [item.providerId, item]));
  const recentItems: SelectableProvider[] = [];
  for (const providerId of recent) {
    const item = byId.get(providerId);
    if (item) recentItems.push(item);
  }
  const recentIds = new Set(recentItems.map((item) => item.providerId));
  const remaining = filtered.filter((item) => !recentIds.has(item.providerId));

  const sections: Section[] = [];
  if (recentItems.length > 0) {
    sections.push({ key: "recent", label: "RECENT", items: recentItems });
  }
  if (remaining.length > 0) {
    sections.push({ key: "all", label: "ALL", items: remaining });
  }
  return sections;
}

export function ModelSelector({ config, switching, onSelect, onOpenSettings }: ModelSelectorProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const listboxId = useId();

  const items = useMemo(() => selectableProviders(config), [config]);
  const sections = useMemo(
    () => buildSections(items, config?.recentProviderIds ?? [], query),
    [items, config?.recentProviderIds, query],
  );
  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const active = useMemo(() => items.find((item) => item.isActive) ?? null, [items]);
  const noModels = items.length === 0;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setFocusIndex(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(event.target as Node)) return;
      close();
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setFocusIndex((current) => {
      if (flatItems.length === 0) return 0;
      return Math.min(current, flatItems.length - 1);
    });
  }, [flatItems.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const node = optionRefs.current[focusIndex];
    node?.scrollIntoView({ block: "nearest" });
  }, [open, focusIndex]);

  const handleSelect = useCallback(async (providerId: string) => {
    close();
    buttonRef.current?.focus();
    await onSelect(providerId);
  }, [close, onSelect]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusIndex((current) => (flatItems.length === 0 ? 0 : (current + 1) % flatItems.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusIndex((current) => {
        if (flatItems.length === 0) return 0;
        return (current - 1 + flatItems.length) % flatItems.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const candidate = flatItems[focusIndex];
      if (candidate) void handleSelect(candidate.providerId);
    }
  }

  if (noModels) {
    return (
      <button
        type="button"
        className="model-selector model-selector-empty"
        onClick={onOpenSettings}
        aria-label={t("chat.chooseModel")}
      >
        <GearSix size={12} weight="regular" />
        <span>{t("chat.chooseModel")}</span>
      </button>
    );
  }

  const activeLabel = active
    ? `${active.displayLabel} / ${active.model}`
    : t("chat.modelConnectionRequired");
  const tooltip = active ? `${active.providerId} / ${active.model}` : activeLabel;
  let focusOffset = 0;

  return (
    <div className="model-selector-wrapper" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? "model-selector is-open" : "model-selector"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={tooltip}
        disabled={switching}
        onClick={() => setOpen((value) => !value)}
      >
        {active ? (
          <ProviderIcon providerId={active.providerId} displayLabel={active.displayLabel} size={12} />
        ) : (
          <GearSix size={12} weight="regular" aria-hidden="true" />
        )}
        <span className="model-selector-label">
          {active ? active.model : t("chat.modelConnectionRequired")}
        </span>
        <CaretDown size={10} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <div
          className="model-selector-popover"
          role="dialog"
          aria-label={t("chat.modelSelectorAria")}
          onKeyDown={handleKeyDown}
        >
          <div className="model-selector-search">
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder={t("chat.modelSearchPlaceholder")}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("chat.modelSearchAria")}
              aria-controls={listboxId}
              aria-activedescendant={
                flatItems[focusIndex] ? `${listboxId}-option-${focusIndex}` : undefined
              }
            />
          </div>
          {sections.length === 0 ? (
            <p className="model-selector-empty-state">{t("chat.modelSearchNoResults")}</p>
          ) : (
            <ul
              className="model-selector-list"
              role="listbox"
              id={listboxId}
              tabIndex={-1}
            >
              {sections.flatMap((section) => {
                const sectionStart = focusOffset;
                const rendered = (
                  <li key={`${section.key}-header`} className="model-selector-section" role="presentation">
                    {section.label}
                  </li>
                );
                const items = section.items.map((item, indexInSection) => {
                  const index = sectionStart + indexInSection;
                  const focused = index === focusIndex;
                  return (
                    <li
                      key={`${section.key}-${item.providerId}`}
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-selected={item.isActive}
                      className={
                        focused
                          ? "model-selector-option is-focused"
                          : "model-selector-option"
                      }
                      ref={(node) => { optionRefs.current[index] = node; }}
                      onMouseMove={() => setFocusIndex(index)}
                      onClick={() => void handleSelect(item.providerId)}
                    >
                      <ProviderIcon providerId={item.providerId} displayLabel={item.displayLabel} size={12} />
                      <span className="model-selector-option-label">
                        <span className="model-selector-option-model">{item.model}</span>
                        <span className="model-selector-option-provider">{item.displayLabel}</span>
                      </span>
                      {item.isActive && <Check size={11} weight="bold" aria-hidden="true" />}
                    </li>
                  );
                });
                focusOffset += section.items.length;
                return [rendered, ...items];
              })}
            </ul>
          )}
          <button
            type="button"
            className="model-selector-configure"
            onClick={() => {
              close();
              onOpenSettings();
            }}
          >
            <GearSix size={11} weight="regular" />
            <span>{t("chat.configureModelConnections")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
