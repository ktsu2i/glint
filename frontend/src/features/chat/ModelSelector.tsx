import type { KeyboardEvent, ReactElement } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  GearSixIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  addCustomModel,
  listProviderModels,
  removeCustomModel,
  type ActiveModelRef,
  type LLMConfig,
  type ModelListingResult,
  type ModelSource,
  type ProviderSettings,
} from "../../shared/api/backend";
import { ProviderIcon } from "./ProviderIcon";

type ModelSelectorProps = {
  config: LLMConfig | null;
  switching: boolean;
  onSelect: (providerId: string, modelId: string) => void | Promise<void>;
  onOpenSettings: () => void;
  onConfigChange?: (next: LLMConfig) => void;
};

type SelectableEntry = {
  providerId: string;
  modelId: string;
  providerLabel: string;
  isActive: boolean;
  isRecent: boolean;
  isCustom: boolean;
};

const OPENAI_COMPATIBLE_PREFIX = "openai_compatible:";

function isCustomProviderId(providerId: string): boolean {
  return providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

function providerDisplayLabel(config: LLMConfig | null, provider: ProviderSettings): string {
  if (provider.displayLabel) return provider.displayLabel;
  const descriptor =
    config?.catalog.find((entry) => entry.id === provider.providerId) ??
    config?.catalog.find((entry) => entry.id === "openai_compatible");
  return descriptor?.displayName ?? provider.providerId;
}

function refsMatch(
  a: ActiveModelRef | undefined | null,
  providerId: string,
  modelId: string,
): boolean {
  if (!a) return false;
  return a.providerId === providerId && a.modelId === modelId;
}

type ProviderGroup = {
  providerId: string;
  providerLabel: string;
  isCustom: boolean;
  listing: ModelListingResult | null;
  entries: SelectableEntry[];
};

function buildGroups(
  config: LLMConfig | null,
  listings: Map<string, ModelListingResult>,
): ProviderGroup[] {
  if (!config) return [];
  const active = config.activeModelRef;
  const recents = new Set(
    (config.recentModels ?? []).map((ref) => `${ref.providerId} ${ref.modelId}`),
  );
  const groups: ProviderGroup[] = [];

  for (const provider of config.providers) {
    if (!provider.configured) continue;
    const label = providerDisplayLabel(config, provider);
    const isCustom = isCustomProviderId(provider.providerId);
    const listing = listings.get(provider.providerId) ?? null;
    const seen = new Set<string>();
    const entries: SelectableEntry[] = [];

    const push = (modelId: string, custom: boolean) => {
      const trimmed = modelId.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      entries.push({
        providerId: provider.providerId,
        modelId: trimmed,
        providerLabel: label,
        isActive: refsMatch(active, provider.providerId, trimmed),
        isRecent: recents.has(`${provider.providerId} ${trimmed}`),
        isCustom: custom,
      });
    };

    if (isCustom) {
      for (const id of provider.models ?? []) push(id, true);
    } else if (listing && listing.models.length > 0) {
      for (const model of listing.models) push(model.id, false);
    } else if (provider.model) {
      push(provider.model, false);
    }

    groups.push({
      providerId: provider.providerId,
      providerLabel: label,
      isCustom,
      listing,
      entries,
    });
  }

  return groups;
}

function filterGroups(groups: ProviderGroup[], query: string): ProviderGroup[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return groups;
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        (entry) =>
          entry.modelId.toLowerCase().includes(trimmed) ||
          entry.providerLabel.toLowerCase().includes(trimmed) ||
          entry.providerId.toLowerCase().includes(trimmed),
      ),
    }))
    .filter((group) => group.entries.length > 0);
}

function pickRecents(groups: ProviderGroup[], recents: ActiveModelRef[]): SelectableEntry[] {
  if (recents.length === 0) return [];
  const byKey = new Map<string, SelectableEntry>();
  for (const group of groups) {
    for (const entry of group.entries) {
      byKey.set(`${entry.providerId} ${entry.modelId}`, entry);
    }
  }
  const out: SelectableEntry[] = [];
  const seen = new Set<string>();
  for (const ref of recents) {
    const key = `${ref.providerId} ${ref.modelId}`;
    if (seen.has(key)) continue;
    const entry = byKey.get(key);
    if (!entry) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function entryKey(entry: SelectableEntry): string {
  return `${entry.providerId} ${entry.modelId}`;
}

function sourceLabelFor(translate: TFunction, source: ModelSource): string {
  switch (source) {
    case "api":
      return translate("chat.modelSelector.sourceApi");
    case "cache":
      return translate("chat.modelSelector.sourceCache");
    case "builtin":
      return translate("chat.modelSelector.sourceBuiltin");
    default:
      return "";
  }
}

function formatRelativeTime(now: Date, fetchedAt: string | undefined, locale: string): string {
  if (!fetchedAt) return "";
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (seconds < 60) return formatter.format(-seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  const days = Math.round(hours / 24);
  return formatter.format(-days, "day");
}

export function ModelSelector({
  config,
  switching,
  onSelect,
  onOpenSettings,
  onConfigChange,
}: ModelSelectorProps) {
  const { t, i18n } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [listings, setListings] = useState<Map<string, ModelListingResult>>(new Map());
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [customDraftByProvider, setCustomDraftByProvider] = useState<Record<string, string>>({});
  const [mutatingCustom, setMutatingCustom] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState("");
  const listboxId = useId();

  const groups = useMemo(() => buildGroups(config, listings), [config, listings]);
  const filteredGroups = useMemo(() => filterGroups(groups, query), [groups, query]);
  const recentEntries = useMemo(
    () => pickRecents(filteredGroups, config?.recentModels ?? []),
    [filteredGroups, config?.recentModels],
  );
  const flatItems = useMemo<SelectableEntry[]>(() => {
    const items: SelectableEntry[] = [...recentEntries];
    const recentKeys = new Set(recentEntries.map((entry) => entryKey(entry)));
    for (const group of filteredGroups) {
      for (const entry of group.entries) {
        if (recentKeys.has(entryKey(entry))) continue;
        items.push(entry);
      }
    }
    return items;
  }, [filteredGroups, recentEntries]);
  const allItems = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const active = useMemo(() => allItems.find((item) => item.isActive) ?? null, [allItems]);
  const noModels = allItems.length === 0;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setFocusIndex(0);
    setActionError("");
  }, []);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (event.target instanceof Node && wrapperRef.current.contains(event.target)) return;
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
    if (!open || !config) return;
    let cancelled = false;
    const targets = config.providers
      .filter((provider) => provider.configured)
      .filter((provider) => !isCustomProviderId(provider.providerId))
      .filter((provider) => !listings.has(provider.providerId));
    if (targets.length === 0) return;
    void Promise.all(
      targets.map(async (provider) => {
        try {
          const result = await listProviderModels(provider.providerId);
          if (cancelled) return;
          setListings((current) => {
            const next = new Map(current);
            next.set(provider.providerId, result);
            return next;
          });
        } catch {}
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [open, config, listings]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 候補数の変化に合わせて focus index を clamp する。
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

  const handleSelect = useCallback(
    async (providerId: string, modelId: string) => {
      close();
      buttonRef.current?.focus();
      await onSelect(providerId, modelId);
    },
    [close, onSelect],
  );

  const refreshListing = useCallback(
    async (providerId: string) => {
      setActionError("");
      setRefreshing((current) => {
        const next = new Set(current);
        next.add(providerId);
        return next;
      });
      try {
        const result = await listProviderModels(providerId, { force: true });
        setListings((current) => {
          const next = new Map(current);
          next.set(providerId, result);
          return next;
        });
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : t("chat.modelSelector.refreshFailed");
        setActionError(message);
      } finally {
        setRefreshing((current) => {
          const next = new Set(current);
          next.delete(providerId);
          return next;
        });
      }
    },
    [t],
  );

  const beginCustomDraft = useCallback((providerId: string, value: string) => {
    setCustomDraftByProvider((current) => ({ ...current, [providerId]: value }));
  }, []);

  const handleAddCustom = useCallback(
    async (providerId: string) => {
      const draft = (customDraftByProvider[providerId] ?? "").trim();
      if (!draft) return;
      setActionError("");
      setMutatingCustom((current) => {
        const next = new Set(current);
        next.add(providerId);
        return next;
      });
      try {
        const nextConfig = await addCustomModel(providerId, draft);
        onConfigChange?.(nextConfig);
        setCustomDraftByProvider((current) => ({ ...current, [providerId]: "" }));
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : t("chat.modelSelector.addFailed");
        setActionError(message);
      } finally {
        setMutatingCustom((current) => {
          const next = new Set(current);
          next.delete(providerId);
          return next;
        });
      }
    },
    [customDraftByProvider, onConfigChange, t],
  );

  const handleRemoveCustom = useCallback(
    async (providerId: string, modelId: string) => {
      setActionError("");
      setMutatingCustom((current) => {
        const next = new Set(current);
        next.add(providerId);
        return next;
      });
      try {
        const nextConfig = await removeCustomModel(providerId, modelId);
        onConfigChange?.(nextConfig);
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : t("chat.modelSelector.removeFailed");
        setActionError(message);
      } finally {
        setMutatingCustom((current) => {
          const next = new Set(current);
          next.delete(providerId);
          return next;
        });
      }
    },
    [onConfigChange, t],
  );

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
      const { target } = event;
      if (!(target instanceof HTMLInputElement) || target.type !== "text") {
        return;
      }
      if (target !== searchRef.current) return;
      event.preventDefault();
      const candidate = flatItems[focusIndex];
      if (candidate) void handleSelect(candidate.providerId, candidate.modelId);
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
        <GearSixIcon size={12} weight="regular" />
        <span>{t("chat.chooseModel")}</span>
      </button>
    );
  }

  const activeLabel = active
    ? `${active.providerLabel} / ${active.modelId}`
    : t("chat.modelConnectionRequired");
  const tooltip = active ? `${active.providerId} / ${active.modelId}` : activeLabel;

  // oxlint-disable-next-line react/purity -- 相対時刻表示用。描画ごとに現在時刻を取る。
  const now = new Date();
  let cursor = 0;
  const recentKeys = new Set(recentEntries.map((entry) => entryKey(entry)));

  const renderOption = (entry: SelectableEntry, sectionKey: string) => {
    const index = cursor;
    // oxlint-disable-next-line react/immutability -- flatItems の index を描画順に振るための render 内ローカル counter。
    cursor += 1;
    const focused = index === focusIndex;
    const key = `${sectionKey}-${entryKey(entry)}`;
    const isMutating = mutatingCustom.has(entry.providerId);
    return (
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard 操作は popover の onKeyDown と aria-activedescendant で扱う。
      <li
        key={key}
        id={`${listboxId}-option-${index}`}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- listbox の option。
        role="option"
        aria-selected={entry.isActive}
        className={focused ? "model-selector-option is-focused" : "model-selector-option"}
        ref={(node) => {
          optionRefs.current[index] = node;
        }}
        onMouseMove={() => setFocusIndex(index)}
        onClick={() => void handleSelect(entry.providerId, entry.modelId)}
      >
        <ProviderIcon providerId={entry.providerId} displayLabel={entry.providerLabel} size={12} />
        <span className="model-selector-option-label">
          <span className="model-selector-option-model">{entry.modelId}</span>
          <span className="model-selector-option-provider">{entry.providerLabel}</span>
        </span>
        {entry.isActive && <CheckIcon size={11} weight="bold" aria-hidden="true" />}
        {entry.isCustom && (
          <button
            type="button"
            className="model-selector-option-remove"
            aria-label={t("chat.modelSelector.removeCustomModel", { model: entry.modelId })}
            onClick={(event) => {
              event.stopPropagation();
              if (isMutating) return;
              void handleRemoveCustom(entry.providerId, entry.modelId);
            }}
            disabled={isMutating}
          >
            <XIcon size={10} weight="bold" aria-hidden="true" />
          </button>
        )}
      </li>
    );
  };

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
          <ProviderIcon
            providerId={active.providerId}
            displayLabel={active.providerLabel}
            size={12}
          />
        ) : (
          <GearSixIcon size={12} weight="regular" aria-hidden="true" />
        )}
        <span className="model-selector-label">
          {active ? active.modelId : t("chat.modelConnectionRequired")}
        </span>
        <CaretDownIcon size={10} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- popover 内の key 操作 (矢印 / Enter / Escape) をまとめて扱う。
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
          {actionError && (
            <p className="model-selector-error" role="alert">
              {actionError}
            </p>
          )}
          {filteredGroups.length === 0 ? (
            <p className="model-selector-empty-state">{t("chat.modelSearchNoResults")}</p>
          ) : (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- combobox の listbox。focus は search input 側で aria-activedescendant により管理する。
            <ul className="model-selector-list" role="listbox" id={listboxId} tabIndex={-1}>
              {recentEntries.length > 0 && (
                <li className="model-selector-section" role="presentation">
                  {t("chat.modelSelector.recentLabel")}
                </li>
              )}
              {recentEntries.map((entry) => renderOption(entry, "recent"))}

              {filteredGroups.map((group) => {
                const sourceLabel = group.listing ? sourceLabelFor(t, group.listing.source) : "";
                const fetchedRel = formatRelativeTime(now, group.listing?.fetchedAt, i18n.language);
                const isRefreshing = refreshing.has(group.providerId);
                const isMutatingThis = mutatingCustom.has(group.providerId);
                const showSkeleton = isRefreshing || isMutatingThis;
                const draftValue = customDraftByProvider[group.providerId] ?? "";
                const visibleEntries = group.entries.filter(
                  (entry) => !recentKeys.has(entryKey(entry)),
                );
                return (
                  <ProviderSectionFragment
                    key={group.providerId}
                    group={group}
                    sourceLabel={sourceLabel}
                    fetchedRel={fetchedRel}
                    showSkeleton={showSkeleton}
                    isRefreshing={isRefreshing}
                    isMutatingThis={isMutatingThis}
                    draftValue={draftValue}
                    visibleEntries={visibleEntries}
                    onRefresh={refreshListing}
                    onDraftChange={beginCustomDraft}
                    onAddCustom={handleAddCustom}
                    renderOption={renderOption}
                    t={t}
                  />
                );
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
            <GearSixIcon size={11} weight="regular" />
            <span>{t("chat.configureModelConnections")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

type ProviderSectionProps = {
  group: ProviderGroup;
  sourceLabel: string;
  fetchedRel: string;
  showSkeleton: boolean;
  isRefreshing: boolean;
  isMutatingThis: boolean;
  draftValue: string;
  visibleEntries: SelectableEntry[];
  onRefresh: (providerId: string) => void | Promise<void>;
  onDraftChange: (providerId: string, value: string) => void;
  onAddCustom: (providerId: string) => void | Promise<void>;
  renderOption: (entry: SelectableEntry, sectionKey: string) => ReactElement;
  t: TFunction;
};

function ProviderSectionFragment({
  group,
  sourceLabel,
  fetchedRel,
  showSkeleton,
  isRefreshing,
  isMutatingThis,
  draftValue,
  visibleEntries,
  onRefresh,
  onDraftChange,
  onAddCustom,
  renderOption,
  t,
}: ProviderSectionProps) {
  const refreshLabel = isRefreshing
    ? t("chat.modelSelector.refreshing")
    : t("chat.modelSelector.refresh");
  return (
    <>
      <li className="model-selector-section model-selector-section-provider" role="presentation">
        <ProviderIcon providerId={group.providerId} displayLabel={group.providerLabel} size={11} />
        <span className="model-selector-section-name">{group.providerLabel}</span>
        {sourceLabel && (
          <span
            className="model-selector-source-badge"
            data-source={group.listing?.source ?? "builtin"}
          >
            {sourceLabel}
          </span>
        )}
        {fetchedRel && <span className="model-selector-section-fetched">{fetchedRel}</span>}
        {!group.isCustom && (
          <button
            type="button"
            className="model-selector-refresh"
            onClick={() => void onRefresh(group.providerId)}
            disabled={isRefreshing}
            aria-label={t("chat.modelSelector.refreshAria", { provider: group.providerLabel })}
            title={refreshLabel}
          >
            <ArrowsClockwiseIcon size={10} weight="bold" aria-hidden="true" />
            <span className="model-selector-refresh-label">{refreshLabel}</span>
          </button>
        )}
      </li>
      {showSkeleton && (
        <li className="model-selector-skeleton" role="presentation">
          <span className="model-selector-skeleton-bar" />
          <span className="model-selector-skeleton-bar" />
        </li>
      )}
      {!showSkeleton && visibleEntries.map((entry) => renderOption(entry, group.providerId))}
      {group.isCustom && (
        <li className="model-selector-custom-add" role="presentation">
          <input
            type="text"
            value={draftValue}
            onChange={(event) => onDraftChange(group.providerId, event.target.value)}
            placeholder={t("chat.modelSelector.customModelPlaceholder")}
            aria-label={t("chat.modelSelector.customModelInputAria", {
              provider: group.providerLabel,
            })}
            disabled={isMutatingThis}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!draftValue.trim() || isMutatingThis) return;
                void onAddCustom(group.providerId);
              }
            }}
          />
          <button
            type="button"
            className="model-selector-custom-add-button"
            disabled={!draftValue.trim() || isMutatingThis}
            aria-label={t("chat.modelSelector.addCustomModel")}
            onClick={() => void onAddCustom(group.providerId)}
          >
            <PlusIcon size={10} weight="bold" aria-hidden="true" />
            <span>{t("chat.modelSelector.addCustomModel")}</span>
          </button>
        </li>
      )}
    </>
  );
}
