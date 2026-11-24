import type { SubmitEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Switch } from "@base-ui/react/switch";
import { useTranslation } from "react-i18next";
import {
  CaretDownIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  TranslateIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  deleteProviderSettings,
  getLLMConfig,
  testProviderConnection,
  upsertProviderSettings,
  type LLMConfig,
  type ProviderDescriptor,
  type ProviderSettings,
  type ThemePreference,
} from "../../shared/api/backend";
import { useLanguageSettings } from "../../shared/i18n/i18n";
import { localizeBackendError } from "../../shared/i18n/error";

type LLMSettingsPageProps = {
  onBack: () => void;
  theme?: ThemePreference;
  themeLoading?: boolean;
  themeError?: string;
  onThemeChange?: (theme: ThemePreference) => Promise<void>;
};

const themeOptions: Array<{
  value: ThemePreference;
  icon: typeof SunIcon;
}> = [
  { value: "light", icon: SunIcon },
  { value: "dark", icon: MoonIcon },
  { value: "system", icon: MonitorIcon },
];

function extractErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string" && reason.trim() !== "") return reason;
  return fallback;
}

function defaultOptionsFor(descriptor: ProviderDescriptor): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const option of descriptor.optionSchema) {
    if (option.default !== undefined) {
      defaults[option.key] = option.default;
    } else if (option.type === "bool") {
      defaults[option.key] = false;
    } else if (option.type === "headers") {
      defaults[option.key] = {};
    } else {
      defaults[option.key] = "";
    }
  }
  return defaults;
}

function mergeOptions(
  descriptor: ProviderDescriptor,
  stored: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const defaults = defaultOptionsFor(descriptor);
  return { ...defaults, ...stored };
}

const OPENAI_COMPATIBLE_TEMPLATE_ID = "openai_compatible";
const OPENAI_COMPATIBLE_PREFIX = "openai_compatible:";
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function isOpenAICompatibleInstance(providerId: string): boolean {
  return (
    providerId.startsWith(OPENAI_COMPATIBLE_PREFIX) &&
    providerId.length > OPENAI_COMPATIBLE_PREFIX.length
  );
}

function envVarNameFor(providerId: string): string {
  const trimmed = providerId.trim();
  if (!trimmed) return "";
  if (isOpenAICompatibleInstance(trimmed)) {
    const slug = trimmed.slice(OPENAI_COMPATIBLE_PREFIX.length);
    if (!slug) return "";
    return `GLINT_OPENAI_COMPATIBLE_${slug.toUpperCase().replaceAll("-", "_")}_API_KEY`;
  }
  return `GLINT_${trimmed.toUpperCase()}_API_KEY`;
}

function resolveDescriptor(config: LLMConfig, providerId: string): ProviderDescriptor | null {
  if (isOpenAICompatibleInstance(providerId)) {
    return (
      config.catalog.find((descriptor) => descriptor.id === OPENAI_COMPATIBLE_TEMPLATE_ID) ?? null
    );
  }
  return config.catalog.find((descriptor) => descriptor.id === providerId) ?? null;
}

async function noopThemeChange(): Promise<void> {}

function headersToText(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  return Object.entries(value)
    .map(([key, val]) => `${key}: ${typeof val === "string" ? val : ""}`)
    .join("\n");
}

function parseHeadersText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

type ProviderRowDescriptor = {
  rowId: string;
  providerId: string;
  descriptor: ProviderDescriptor;
  stored: ProviderSettings | null;
  displayName: string;
  isCustom: boolean;
  isStaged: boolean;
  endpointHint: string;
};

function providerDisplayName(
  providerId: string,
  descriptor: ProviderDescriptor,
  stored: ProviderSettings | null,
  fallbackLabel = "",
): string {
  if (isOpenAICompatibleInstance(providerId)) {
    const label =
      stored?.displayLabel || fallbackLabel || providerId.slice(OPENAI_COMPATIBLE_PREFIX.length);
    return label || providerId;
  }
  return descriptor.displayName;
}

function endpointHintFor(
  providerId: string,
  descriptor: ProviderDescriptor,
  stored: ProviderSettings | null,
): string {
  if (isOpenAICompatibleInstance(providerId)) {
    const baseUrl = stored?.options?.["base_url"];
    if (typeof baseUrl === "string" && baseUrl.trim() !== "") return baseUrl;
  }
  if (providerId === "ollama") return descriptor.defaultBaseUrl ?? "";
  return "";
}

function buildRows(config: LLMConfig, staged: StagedCustom | null): ProviderRowDescriptor[] {
  const builtIns = config.catalog.filter(
    (descriptor) => descriptor.id !== OPENAI_COMPATIBLE_TEMPLATE_ID,
  );
  const template =
    config.catalog.find((descriptor) => descriptor.id === OPENAI_COMPATIBLE_TEMPLATE_ID) ?? null;
  const configured: ProviderRowDescriptor[] = [];
  const unconfigured: ProviderRowDescriptor[] = [];

  for (const descriptor of builtIns) {
    const stored =
      config.providers.find((provider) => provider.providerId === descriptor.id) ?? null;
    const row: ProviderRowDescriptor = {
      rowId: descriptor.id,
      providerId: descriptor.id,
      descriptor,
      stored,
      displayName: providerDisplayName(descriptor.id, descriptor, stored),
      isCustom: false,
      isStaged: false,
      endpointHint: endpointHintFor(descriptor.id, descriptor, stored),
    };
    if (stored?.configured === true) configured.push(row);
    else unconfigured.push(row);
  }

  const customs: ProviderRowDescriptor[] = [];
  if (template) {
    const customProviders = config.providers
      .filter((provider) => isOpenAICompatibleInstance(provider.providerId))
      .toSorted((a, b) =>
        (a.displayLabel || a.providerId).localeCompare(b.displayLabel || b.providerId),
      );
    for (const stored of customProviders) {
      customs.push({
        rowId: stored.providerId,
        providerId: stored.providerId,
        descriptor: template,
        stored,
        displayName: providerDisplayName(stored.providerId, template, stored),
        isCustom: true,
        isStaged: false,
        endpointHint: endpointHintFor(stored.providerId, template, stored),
      });
    }
  }

  const stagedRow: ProviderRowDescriptor[] = [];
  if (
    staged &&
    template &&
    !config.providers.some((provider) => provider.providerId === staged.providerId)
  ) {
    stagedRow.push({
      rowId: staged.providerId,
      providerId: staged.providerId,
      descriptor: template,
      stored: null,
      displayName: staged.displayLabel || staged.providerId.slice(OPENAI_COMPATIBLE_PREFIX.length),
      isCustom: true,
      isStaged: true,
      endpointHint: "",
    });
  }

  return [...configured, ...customs, ...unconfigured, ...stagedRow];
}

type StagedCustom = {
  providerId: string;
  displayLabel: string;
};

export function LLMSettingsPage({
  onBack,
  theme = "system",
  themeLoading = false,
  themeError = "",
  onThemeChange = noopThemeChange,
}: LLMSettingsPageProps) {
  const { t } = useTranslation();
  const {
    language,
    loading: languageLoading,
    error: languageError,
    changeLanguage,
  } = useLanguageSettings();
  const translationRef = useRef(t);
  // oxlint-disable-next-line react/refs -- 最新の t を callback から参照するための latest-ref pattern。
  translationRef.current = t;

  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [managedProviderId, setManagedProviderId] = useState<string>("");
  const [staged, setStaged] = useState<StagedCustom | null>(null);
  const [displayLabel, setDisplayLabel] = useState("");
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [apiKey, setAPIKey] = useState("");
  const [showAPIKey, setShowAPIKey] = useState(false);
  const [clearAPIKey, setClearAPIKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTest, setConnectionTest] = useState<"success" | "error" | null>(null);
  const [connectionTestError, setConnectionTestError] = useState("");
  const [removingId, setRemovingId] = useState<string>("");
  const [removedLabel, setRemovedLabel] = useState("");
  const [localThemeError, setLocalThemeError] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [newCustomSlug, setNewCustomSlug] = useState("");
  const [newCustomLabel, setNewCustomLabel] = useState("");
  const [newCustomError, setNewCustomError] = useState("");

  const rows = useMemo<ProviderRowDescriptor[]>(() => {
    if (!config) return [];
    return buildRows(config, staged);
  }, [config, staged]);

  const managedRow = useMemo<ProviderRowDescriptor | null>(() => {
    if (!managedProviderId) return null;
    return rows.find((row) => row.rowId === managedProviderId) ?? null;
  }, [managedProviderId, rows]);

  const managedDescriptor = managedRow?.descriptor ?? null;
  const managedStored = managedRow?.stored ?? null;
  const managedIsCustom = managedRow?.isCustom ?? false;

  const openManagePanel = useCallback(
    (
      rowId: string,
      descriptor: ProviderDescriptor,
      stored: ProviderSettings | null,
      label = "",
    ) => {
      setManagedProviderId(rowId);
      setDisplayLabel(stored?.displayLabel ?? label);
      setOptions(mergeOptions(descriptor, stored?.options));
      setAPIKey("");
      setShowAPIKey(false);
      setClearAPIKey(false);
      setSaved(false);
      setConnectionTest(null);
      setConnectionTestError("");
    },
    [],
  );

  const closeManagePanel = useCallback((discardStaged = false) => {
    setManagedProviderId("");
    setDisplayLabel("");
    setOptions({});
    setAPIKey("");
    setShowAPIKey(false);
    setClearAPIKey(false);
    setSaved(false);
    setConnectionTest(null);
    setConnectionTestError("");
    if (discardStaged) setStaged(null);
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await getLLMConfig();
      setConfig(loaded);
      closeManagePanel();
    } catch (reason) {
      setError(extractErrorMessage(reason, translationRef.current("settings.loadError")));
    } finally {
      setLoading(false);
    }
  }, [closeManagePanel]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 初回 load。loading 表示を含めて loadSettings に集約している。
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 入力変更時に接続テスト結果を reset する。
    setConnectionTest(null);
    setConnectionTestError("");
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- 入力が変わったら前回の接続テスト結果を破棄する。
  }, [apiKey, clearAPIKey, options, managedProviderId]);

  useEffect(() => {
    if (!removedLabel) return;
    const timer = window.setTimeout(() => setRemovedLabel(""), 2400);
    return () => window.clearTimeout(timer);
  }, [removedLabel]);

  async function handleSave(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !managedDescriptor || !managedProviderId) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const trimmedLabel = displayLabel.trim();
      const next = await upsertProviderSettings({
        providerId: managedProviderId,
        options,
        apiKey: apiKey.trim(),
        clearApiKey: clearAPIKey,
        ...(trimmedLabel ? { displayLabel: trimmedLabel } : {}),
      });
      setConfig(next);
      setStaged(null);
      const refreshedStored =
        next.providers.find((provider) => provider.providerId === managedProviderId) ?? null;
      openManagePanel(managedProviderId, managedDescriptor, refreshedStored);
      setSaved(true);
    } catch (reason) {
      setError(localizeBackendError(extractErrorMessage(reason, t("settings.saveError")), t));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (testingConnection || !managedDescriptor || !managedProviderId) return;
    setTestingConnection(true);
    setConnectionTest(null);
    setConnectionTestError("");
    try {
      if (managedDescriptor.authKind === "none" && !managedStored) {
        const next = await upsertProviderSettings({
          providerId: managedProviderId,
          options: {},
          apiKey: "",
          clearApiKey: false,
        });
        setConfig(next);
      }
      const result = await testProviderConnection(managedProviderId);
      if (result.ok) {
        setConnectionTest("success");
      } else {
        setConnectionTest("error");
        setConnectionTestError(
          localizeBackendError(result.error || t("settings.testConnectionFailed"), t),
        );
      }
    } catch (reason) {
      setConnectionTest("error");
      setConnectionTestError(
        localizeBackendError(extractErrorMessage(reason, t("settings.testConnectionFailed")), t),
      );
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleRemoveCustom(row: ProviderRowDescriptor) {
    if (!row.isCustom) return;
    if (!window.confirm(t("settings.providerRemoveConfirm", { provider: row.displayName }))) return;
    setRemovingId(row.rowId);
    setError("");
    try {
      if (row.isStaged) {
        setStaged((current) => (current?.providerId === row.rowId ? null : current));
      } else {
        const next = await deleteProviderSettings(row.providerId);
        setConfig(next);
      }
      if (managedProviderId === row.rowId) closeManagePanel();
      setRemovedLabel(row.displayName);
    } catch (reason) {
      setError(localizeBackendError(extractErrorMessage(reason, t("settings.saveError")), t));
    } finally {
      setRemovingId("");
    }
  }

  function startCustomProviderFlow() {
    setIsAddingCustom(true);
    setNewCustomSlug("");
    setNewCustomLabel("");
    setNewCustomError("");
  }

  function cancelCustomProviderFlow() {
    setIsAddingCustom(false);
    setNewCustomSlug("");
    setNewCustomLabel("");
    setNewCustomError("");
  }

  function confirmCustomProvider() {
    const slug = newCustomSlug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      setNewCustomError(t("settings.customProviderInvalidSlug"));
      return;
    }
    if (!config) return;
    const providerId = `${OPENAI_COMPATIBLE_PREFIX}${slug}`;
    const existing = config.providers.find((provider) => provider.providerId === providerId);
    if (existing) {
      const descriptor = resolveDescriptor(config, providerId);
      if (descriptor) openManagePanel(providerId, descriptor, existing);
      setIsAddingCustom(false);
      setNewCustomSlug("");
      setNewCustomLabel("");
      setNewCustomError("");
      return;
    }
    const template = config.catalog.find(
      (descriptor) => descriptor.id === OPENAI_COMPATIBLE_TEMPLATE_ID,
    );
    if (!template) return;
    const label = newCustomLabel.trim() || slug;
    setStaged({ providerId, displayLabel: label });
    openManagePanel(providerId, template, null, label);
    setIsAddingCustom(false);
    setNewCustomSlug("");
    setNewCustomLabel("");
    setNewCustomError("");
  }

  async function handleThemeChange(next: ThemePreference) {
    if (savingTheme || next === theme) return;
    setSavingTheme(true);
    setLocalThemeError("");
    try {
      await onThemeChange(next);
    } catch (reason) {
      setLocalThemeError(extractErrorMessage(reason, t("error.saveAppearance")));
    } finally {
      setSavingTheme(false);
    }
  }

  async function handleLanguageChange(next: "en" | "ja") {
    if (savingLanguage || languageLoading || next === language) return;
    setSavingLanguage(true);
    try {
      await changeLanguage(next);
    } catch {
    } finally {
      setSavingLanguage(false);
    }
  }

  const themeCopy = {
    light: [t("settings.themeLight"), t("settings.themeLightDescription")],
    dark: [t("settings.themeDark"), t("settings.themeDarkDescription")],
    system: [t("settings.themeSystem"), t("settings.themeSystemDescription")],
  } as const;

  const hasCredential = managedStored?.hasApiKey ?? false;
  const isCustomInstance = managedIsCustom;
  const requiresAPIKey = managedDescriptor
    ? managedDescriptor.authKind !== "none" &&
      !(isCustomInstance && options.requires_api_key === false)
    : true;
  const willHaveCredential =
    !requiresAPIKey || apiKey.trim() !== "" || (hasCredential && !clearAPIKey);
  const canSave = !loading && !saving && (willHaveCredential || clearAPIKey);
  const managedLabel = managedRow?.displayName ?? "—";
  const generalOptionSchema = managedDescriptor?.optionSchema ?? [];
  const activeRow = useMemo<ProviderRowDescriptor | null>(() => {
    if (!config?.activeProviderId) return null;
    return rows.find((row) => row.providerId === config.activeProviderId) ?? null;
  }, [config, rows]);
  const headerConfigured = Boolean(activeRow?.stored?.configured);

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-page-shell">
        <header className="settings-page-heading">
          <div>
            <span className="section-label">{t("settings.section")}</span>
            <h1 id="settings-title">{t("settings.title")}</h1>
            <p>{t("settings.description")}</p>
          </div>
          <div
            className={headerConfigured ? "settings-connection is-ready" : "settings-connection"}
          >
            <span className="settings-connection-dot" />
            <div>
              <small>{t("settings.connection")}</small>
              <strong>
                {loading
                  ? t("settings.checking")
                  : headerConfigured
                    ? t("settings.available")
                    : t("settings.notConfigured")}
              </strong>
            </div>
          </div>
        </header>

        <div className="settings-layout">
          <nav className="settings-index" aria-label={t("settings.items")}>
            <span>{t("settings.application")}</span>
            <button type="button" className="is-active" aria-current="page">
              <span aria-hidden="true" />
              {t("settings.appearance")}
            </button>
            <button type="button">{t("settings.modelConnections")}</button>
            <p>{t("settings.credentialNote")}</p>
          </nav>

          <form className="settings-page-form" onSubmit={(event) => void handleSave(event)}>
            <section className="appearance-settings" aria-labelledby="appearance-heading">
              <div className="settings-section-heading">
                <div>
                  <span className="settings-kicker">{t("settings.readingEnvironment")}</span>
                  <h2 id="appearance-heading">{t("settings.appearance")}</h2>
                </div>
                <span className="provider-badge">{t("settings.theme")}</span>
              </div>
              <p className="appearance-description">{t("settings.appearanceDescription")}</p>
              {(themeError || localThemeError) && (
                <div className="settings-error appearance-error" role="alert">
                  <span>{localThemeError || themeError}</span>
                </div>
              )}
              <div className="theme-options" aria-label={t("settings.themeOptions")}>
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const [label, description] = themeCopy[option.value];
                  const selected = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={selected ? "theme-option is-selected" : "theme-option"}
                      aria-pressed={selected}
                      disabled={themeLoading || savingTheme}
                      onClick={() => void handleThemeChange(option.value)}
                    >
                      <Icon size={18} weight={selected ? "fill" : "regular"} />
                      <span>
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </span>
                      <i aria-hidden="true">{selected ? <CheckIcon size={12} /> : null}</i>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="settings-form-divider" />

            <section className="appearance-settings" aria-labelledby="language-heading">
              <div className="settings-section-heading">
                <div>
                  <span className="settings-kicker">{t("settings.languageKicker")}</span>
                  <h2 id="language-heading">{t("settings.language")}</h2>
                </div>
                <span className="provider-badge">
                  <TranslateIcon size={13} /> {language.toUpperCase()}
                </span>
              </div>
              <p className="appearance-description">{t("settings.languageDescription")}</p>
              {(languageError || savingLanguage) && (
                <p
                  className={languageError ? "appearance-error" : "language-saving"}
                  role={languageError ? "alert" : "status"}
                >
                  {languageError || t("settings.languageSaving")}
                </p>
              )}
              <div
                className="theme-options language-options"
                aria-label={t("settings.languageOptions")}
              >
                {(
                  [
                    ["en", t("settings.english"), t("settings.englishDescription")],
                    ["ja", t("settings.japanese"), t("settings.japaneseDescription")],
                  ] as const
                ).map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    className={language === value ? "theme-option is-selected" : "theme-option"}
                    aria-pressed={language === value}
                    disabled={languageLoading || savingLanguage}
                    onClick={() => void handleLanguageChange(value)}
                  >
                    <span className="language-code" aria-hidden="true">
                      {value.toUpperCase()}
                    </span>
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    <i aria-hidden="true">{language === value ? <CheckIcon size={12} /> : null}</i>
                  </button>
                ))}
              </div>
            </section>

            <div className="settings-form-divider" />

            <div className="settings-section-heading">
              <div>
                <span className="settings-kicker">{t("settings.modelConnection")}</span>
                <h2>{t("settings.modelConnections")}</h2>
              </div>
              <span className="provider-badge">{rows.length}</span>
            </div>
            <p className="appearance-description">{t("settings.modelConnectionsDescription")}</p>

            {error && (
              <div className="settings-error" role="alert">
                <span>{error}</span>
                {!config && !loading && (
                  <button type="button" onClick={() => void loadSettings()}>
                    {t("settings.reload")}
                  </button>
                )}
              </div>
            )}
            {removedLabel && (
              <p className="settings-saved" role="status">
                <CheckIcon size={14} /> {t("settings.providerRemoved", { provider: removedLabel })}
              </p>
            )}

            {config && (
              <ul className="provider-list" aria-label={t("settings.providerListAria")}>
                {rows.map((row) => {
                  const isManaged = managedProviderId === row.rowId;
                  const requiresKeyForRow =
                    row.descriptor.authKind !== "none" &&
                    !(row.isCustom && row.stored?.options?.requires_api_key === false);
                  const usesEnvCredential = row.stored?.credentialSource === "env";
                  const envVarName = requiresKeyForRow ? envVarNameFor(row.providerId) : "";
                  const isActive = row.stored?.isActive ?? false;
                  let statusLabel: string;
                  let statusKind: "configured" | "missing" | "endpoint" | "active";
                  if (isActive) {
                    statusLabel = t("settings.statusActive");
                    statusKind = "active";
                  } else if (row.stored?.configured === true) {
                    statusLabel = t("settings.statusConfigured");
                    statusKind = "configured";
                  } else if (row.endpointHint) {
                    statusLabel = t("settings.providerEndpointLabel", { url: row.endpointHint });
                    statusKind = "endpoint";
                  } else {
                    statusLabel = t("settings.statusApiKeyMissing");
                    statusKind = "missing";
                  }
                  return (
                    <li
                      key={row.rowId}
                      className={isManaged ? "provider-row is-expanded" : "provider-row"}
                      data-provider-id={row.rowId}
                      data-status={statusKind}
                    >
                      <button
                        type="button"
                        className="provider-row-summary"
                        aria-expanded={isManaged}
                        aria-controls={`provider-row-${row.rowId}-detail`}
                        onClick={() => {
                          if (isManaged) {
                            closeManagePanel(row.isStaged);
                            return;
                          }
                          openManagePanel(
                            row.rowId,
                            row.descriptor,
                            row.stored,
                            row.isStaged ? row.displayName : "",
                          );
                        }}
                      >
                        <span className="provider-row-identity">
                          <span className="provider-row-name">{row.displayName}</span>
                        </span>
                        <span className={`provider-row-status is-${statusKind}`}>
                          {(statusKind === "configured" || statusKind === "active") && (
                            <CheckIcon size={11} />
                          )}
                          <span>{statusLabel}</span>
                        </span>
                        {usesEnvCredential && envVarName && (
                          <span
                            className="provider-row-env-badge"
                            title={t("settings.credentialFromEnvHelp", { env: envVarName })}
                          >
                            <KeyIcon size={10} /> {t("settings.credentialFromEnvBadge")}
                          </span>
                        )}
                        <CaretDownIcon
                          size={12}
                          weight="bold"
                          className={
                            isManaged ? "provider-row-toggle is-open" : "provider-row-toggle"
                          }
                          aria-hidden="true"
                        />
                      </button>
                      {isManaged && managedDescriptor && (
                        <div
                          id={`provider-row-${row.rowId}-detail`}
                          className="provider-row-detail"
                        >
                          {saved && (
                            <p className="settings-saved" role="status">
                              <CheckIcon size={14} /> {t("settings.saved")}
                            </p>
                          )}
                          {connectionTest === "success" && (
                            <p className="settings-saved" role="status">
                              <CheckIcon size={14} />{" "}
                              {t("settings.testConnectionSucceeded", { provider: managedLabel })}
                            </p>
                          )}
                          {connectionTest === "error" && (
                            <div className="settings-error" role="alert">
                              <span>{connectionTestError}</span>
                            </div>
                          )}

                          {isCustomInstance && (
                            <fieldset className="settings-fieldset" disabled={loading || saving}>
                              <legend>{t("settings.customProviderLabel")}</legend>
                              <div className="settings-field">
                                <label htmlFor={`provider-label-${row.rowId}`}>
                                  {t("settings.customProviderLabel")}
                                </label>
                                <input
                                  id={`provider-label-${row.rowId}`}
                                  value={displayLabel}
                                  onChange={(event) => {
                                    setDisplayLabel(event.target.value);
                                    setSaved(false);
                                  }}
                                  placeholder={row.providerId.slice(
                                    OPENAI_COMPATIBLE_PREFIX.length,
                                  )}
                                  autoComplete="off"
                                />
                                <small>{t("settings.customProviderLabelHelp")}</small>
                              </div>
                            </fieldset>
                          )}

                          {requiresAPIKey && (
                            <fieldset className="settings-fieldset" disabled={loading || saving}>
                              <legend>{t("settings.credential")}</legend>
                              {usesEnvCredential && envVarName && (
                                <p className="provider-row-env-note" role="status">
                                  <KeyIcon size={12} />{" "}
                                  {t("settings.credentialFromEnvHelp", { env: envVarName })}
                                </p>
                              )}
                              <div className="settings-field">
                                <span className="settings-field-label">
                                  <label htmlFor={`provider-api-key-${row.rowId}`}>
                                    {t("settings.apiKey")}
                                  </label>
                                  {hasCredential && !clearAPIKey && (
                                    <em>
                                      <KeyIcon size={11} /> {t("settings.keyStored")}
                                    </em>
                                  )}
                                </span>
                                <div className="credential-input">
                                  <input
                                    id={`provider-api-key-${row.rowId}`}
                                    className={
                                      hasCredential && !apiKey ? "has-saved-credential" : ""
                                    }
                                    type={showAPIKey ? "text" : "password"}
                                    value={apiKey}
                                    onChange={(event) => {
                                      setAPIKey(event.target.value);
                                      if (event.target.value) setClearAPIKey(false);
                                      setSaved(false);
                                    }}
                                    placeholder={
                                      clearAPIKey
                                        ? t("settings.keyScheduledForRemoval")
                                        : hasCredential
                                          ? "••••••••••••••••"
                                          : "sk-or-v1-…"
                                    }
                                    autoComplete="new-password"
                                    disabled={clearAPIKey}
                                    required={!hasCredential}
                                  />
                                  <button
                                    type="button"
                                    className="credential-visibility"
                                    onClick={() => setShowAPIKey((current) => !current)}
                                    disabled={clearAPIKey || apiKey === ""}
                                    aria-label={
                                      showAPIKey
                                        ? t("settings.hideApiKey")
                                        : t("settings.showApiKey")
                                    }
                                  >
                                    {showAPIKey ? (
                                      <EyeSlashIcon size={16} />
                                    ) : (
                                      <EyeIcon size={16} />
                                    )}
                                  </button>
                                </div>
                                <small>
                                  {hasCredential && !apiKey && !clearAPIKey
                                    ? t("settings.savedKeyHelp")
                                    : t("settings.newKeyHelp")}
                                </small>
                                {hasCredential && (
                                  <button
                                    type="button"
                                    className={
                                      clearAPIKey
                                        ? "credential-action is-pending"
                                        : "credential-action"
                                    }
                                    onClick={() => {
                                      setClearAPIKey((current) => !current);
                                      setAPIKey("");
                                      setShowAPIKey(false);
                                      setSaved(false);
                                    }}
                                  >
                                    {clearAPIKey
                                      ? t("settings.keepApiKey")
                                      : t("settings.removeApiKey")}
                                  </button>
                                )}
                              </div>
                            </fieldset>
                          )}

                          {generalOptionSchema.length > 0 && (
                            <fieldset className="settings-fieldset" disabled={loading || saving}>
                              <legend>{t("settings.providerOptions")}</legend>
                              {generalOptionSchema.map((option) => {
                                const value = options[option.key];
                                const fieldId = `provider-option-${row.rowId}-${option.key}`;
                                if (option.type === "bool") {
                                  return (
                                    <div className="privacy-setting" key={option.key}>
                                      <div>
                                        <span>{option.label}</span>
                                        {option.helpText && <p>{option.helpText}</p>}
                                      </div>
                                      <Switch.Root
                                        className="context-switch"
                                        checked={Boolean(value)}
                                        onCheckedChange={(checked) => {
                                          setOptions((current) => ({
                                            ...current,
                                            [option.key]: checked,
                                          }));
                                          setSaved(false);
                                        }}
                                        aria-label={option.label}
                                      >
                                        <Switch.Thumb className="context-switch-thumb" />
                                      </Switch.Root>
                                    </div>
                                  );
                                }
                                if (option.type === "headers") {
                                  return (
                                    <div className="settings-field" key={option.key}>
                                      <label htmlFor={fieldId}>{option.label}</label>
                                      <textarea
                                        id={fieldId}
                                        rows={3}
                                        value={headersToText(value)}
                                        onChange={(event) => {
                                          const parsed = parseHeadersText(event.target.value);
                                          setOptions((current) => ({
                                            ...current,
                                            [option.key]: parsed,
                                          }));
                                          setSaved(false);
                                        }}
                                        placeholder="X-Org-Id: tenant-42"
                                        spellCheck={false}
                                      />
                                      {option.helpText && <small>{option.helpText}</small>}
                                    </div>
                                  );
                                }
                                return (
                                  <div className="settings-field" key={option.key}>
                                    <label htmlFor={fieldId}>{option.label}</label>
                                    <input
                                      id={fieldId}
                                      type={option.type === "url" ? "url" : "text"}
                                      value={typeof value === "string" ? value : ""}
                                      onChange={(event) => {
                                        setOptions((current) => ({
                                          ...current,
                                          [option.key]: event.target.value,
                                        }));
                                        setSaved(false);
                                      }}
                                      placeholder={
                                        typeof option.default === "string" ? option.default : ""
                                      }
                                      autoComplete="off"
                                      spellCheck={false}
                                      required={option.required}
                                    />
                                    {option.helpText && <small>{option.helpText}</small>}
                                  </div>
                                );
                              })}
                            </fieldset>
                          )}

                          <div className="provider-row-detail-actions">
                            {row.isCustom && (
                              <button
                                type="button"
                                className="settings-secondary provider-row-detail-remove"
                                onClick={() => void handleRemoveCustom(row)}
                                disabled={removingId === row.rowId}
                              >
                                <TrashIcon size={12} />
                                {removingId === row.rowId
                                  ? t("settings.providerRemoving")
                                  : t("settings.providerRemove")}
                              </button>
                            )}
                            <button
                              className="settings-secondary"
                              type="button"
                              onClick={() => void handleTestConnection()}
                              disabled={
                                saving ||
                                testingConnection ||
                                (managedStored?.configured !== true &&
                                  managedDescriptor?.authKind !== "none")
                              }
                            >
                              {testingConnection
                                ? t("settings.testingConnection")
                                : t("settings.testConnection")}
                            </button>
                            <button className="settings-primary" type="submit" disabled={!canSave}>
                              {saving ? t("settings.saving") : t("settings.save")}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {config && (
              <button
                type="button"
                className="provider-add-compatible"
                onClick={() => startCustomProviderFlow()}
              >
                <PlusIcon size={12} weight="bold" /> {t("settings.addCompatibleProvider")}
              </button>
            )}

            {isAddingCustom && (
              <div className="provider-custom-modal-backdrop" role="presentation">
                <div
                  className="provider-custom-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("settings.customProviderDialogAria")}
                >
                  <div className="provider-custom-modal-header">
                    <h3>{t("settings.customProviderTitle")}</h3>
                    <button
                      type="button"
                      className="provider-custom-modal-close"
                      aria-label={t("settings.customProviderCancel")}
                      onClick={() => cancelCustomProviderFlow()}
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                  <div className="settings-field">
                    <label htmlFor="custom-provider-slug">{t("settings.customProviderSlug")}</label>
                    <input
                      id="custom-provider-slug"
                      value={newCustomSlug}
                      onChange={(event) => {
                        setNewCustomSlug(event.target.value);
                        setNewCustomError("");
                      }}
                      placeholder="groq"
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                    />
                    <small>{t("settings.customProviderSlugHelp")}</small>
                  </div>
                  <div className="settings-field">
                    <label htmlFor="custom-provider-label">
                      {t("settings.customProviderLabel")}
                    </label>
                    <input
                      id="custom-provider-label"
                      value={newCustomLabel}
                      onChange={(event) => setNewCustomLabel(event.target.value)}
                      placeholder="Groq"
                      autoComplete="off"
                    />
                    <small>{t("settings.customProviderLabelHelp")}</small>
                  </div>
                  {newCustomError && (
                    <p className="settings-error" role="alert">
                      {newCustomError}
                    </p>
                  )}
                  <div className="provider-custom-modal-actions">
                    <button
                      className="settings-secondary"
                      type="button"
                      onClick={() => cancelCustomProviderFlow()}
                    >
                      {t("settings.customProviderCancel")}
                    </button>
                    <button
                      className="settings-primary"
                      type="button"
                      onClick={confirmCustomProvider}
                    >
                      {t("settings.customProviderCreate")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <footer className="settings-page-actions">
              <button
                className="settings-secondary"
                type="button"
                onClick={onBack}
                disabled={saving}
              >
                {t("settings.back")}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </section>
  );
}
