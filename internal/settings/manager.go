package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"sort"
	"strings"

	"github.com/kaito/glint/internal/llm"
	keyring "github.com/zalando/go-keyring"
)

const (
	credentialService = "com.glint.desktop"

	legacyLLMSettingKey      = "llm.openrouter"
	legacyOpenRouterKeyEntry = "openrouter-api-key"

	llmActiveProviderKey = "llm.active_provider"
	llmProvidersKey      = "llm.providers"
	llmMigrationDoneKey  = "llm.migration_v2_done"
)

var ErrSecretNotFound = errors.New("credential not found")

type SettingStore interface {
	Setting(ctx context.Context, key string) (string, error)
	SaveSetting(ctx context.Context, key, value string) error
}

type SecretStore interface {
	Get(service, account string) (string, error)
	Set(service, account, secret string) error
	Delete(service, account string) error
}

type KeyringStore struct{}

func (KeyringStore) Get(service, account string) (string, error) {
	secret, err := keyring.Get(service, account)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrSecretNotFound
	}
	return secret, err
}

func (KeyringStore) Set(service, account, secret string) error {
	return keyring.Set(service, account, secret)
}

func (KeyringStore) Delete(service, account string) error {
	err := keyring.Delete(service, account)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

// ProviderSettings は frontend へ返す1 provider 分の状態。secret 自体は含まない。
type ProviderSettings struct {
	ProviderID   string         `json:"providerId"`
	DisplayLabel string         `json:"displayLabel,omitempty"`
	Model        string         `json:"model"`
	Options      map[string]any `json:"options,omitempty"`
	HasAPIKey    bool           `json:"hasApiKey"`
	Configured   bool           `json:"configured"`
	IsActive     bool           `json:"isActive"`
}

// LLMConfig は GetLLMConfig が返す top-level shape。
type LLMConfig struct {
	ActiveProviderID string                   `json:"activeProviderId"`
	Providers        []ProviderSettings       `json:"providers"`
	Catalog          []llm.ProviderDescriptor `json:"catalog"`
}

// UpsertProviderRequest は frontend が provider 設定を upsert する時の入力。
type UpsertProviderRequest struct {
	ProviderID   string         `json:"providerId"`
	DisplayLabel string         `json:"displayLabel,omitempty"`
	Model        string         `json:"model"`
	Options      map[string]any `json:"options,omitempty"`
	APIKey       string         `json:"apiKey,omitempty"`
	ClearAPIKey  bool           `json:"clearApiKey,omitempty"`
	Activate     bool           `json:"activate,omitempty"`
}

type storedProvider struct {
	DisplayLabel string         `json:"displayLabel,omitempty"`
	Model        string         `json:"model"`
	Options      map[string]any `json:"options,omitempty"`
}

type Manager struct {
	store     SettingStore
	secrets   SecretStore
	registry  *llm.Registry
	migrated  bool
}

func NewManager(store SettingStore, secrets SecretStore) *Manager {
	return &Manager{
		store:    store,
		secrets:  secrets,
		registry: llm.NewRegistry(),
	}
}

// GetLLMConfig returns the catalog plus every configured provider with their
// public state. Calls ensureMigration first so the result reflects the new
// schema even on first read after upgrade.
func (manager *Manager) GetLLMConfig(ctx context.Context) (LLMConfig, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return LLMConfig{}, err
	}
	active, err := manager.loadActiveProviderID(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	return manager.buildConfig(active, stored)
}

// UpsertProviderSettings validates, persists, and optionally activates a
// single provider. Returns the full LLMConfig so callers can refresh their
// view in one round trip.
func (manager *Manager) UpsertProviderSettings(ctx context.Context, request UpsertProviderRequest) (LLMConfig, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return LLMConfig{}, err
	}
	providerID := strings.TrimSpace(request.ProviderID)
	if providerID == "" {
		return LLMConfig{}, errors.New("providerIdを指定してください。")
	}
	if providerID == string(llm.ProviderOpenAICompatible) {
		return LLMConfig{}, errors.New("openai_compatibleには `openai_compatible:<slug>` 形式のproviderIdを指定してください。")
	}
	descriptor, ok := manager.registry.Descriptor(llm.ProviderID(providerID))
	if !ok {
		return LLMConfig{}, fmt.Errorf("未知のproviderです: %s", providerID)
	}
	if request.ClearAPIKey && strings.TrimSpace(request.APIKey) != "" {
		return LLMConfig{}, errors.New("API keyの更新と削除は同時に指定できません。")
	}

	cleanedModel := strings.TrimSpace(request.Model)
	cleanedLabel := strings.TrimSpace(request.DisplayLabel)
	cfg := llm.ProviderConfig{
		ProviderID:   llm.ProviderID(providerID),
		DisplayLabel: cleanedLabel,
		Model:        cleanedModel,
		Options:      normalizedOptions(request.Options),
	}
	if err := manager.registry.Validate(cfg); err != nil {
		return LLMConfig{}, err
	}

	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	stored[providerID] = storedProvider{
		DisplayLabel: cleanedLabel,
		Model:        cleanedModel,
		Options:      cfg.Options,
	}
	if err := manager.saveStoredProviders(ctx, stored); err != nil {
		return LLMConfig{}, err
	}

	if descriptor.RequiresAPIKey() {
		account := apiKeyAccount(providerID)
		if request.ClearAPIKey {
			if err := manager.secrets.Delete(credentialService, account); err != nil {
				return LLMConfig{}, fmt.Errorf("delete %s API key: %w", providerID, err)
			}
		} else if apiKey := strings.TrimSpace(request.APIKey); apiKey != "" {
			if err := manager.secrets.Set(credentialService, account, apiKey); err != nil {
				return LLMConfig{}, fmt.Errorf("save %s API key: %w", providerID, err)
			}
		}
	}

	active, err := manager.loadActiveProviderID(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	if request.Activate || active == "" {
		if err := manager.store.SaveSetting(ctx, llmActiveProviderKey, providerID); err != nil {
			return LLMConfig{}, err
		}
		active = providerID
	}
	return manager.buildConfig(active, stored)
}

// DeleteProviderSettings removes the persisted config + credential for the
// given provider. If it was active, no provider becomes active automatically;
// the frontend can call SetActiveProvider next.
func (manager *Manager) DeleteProviderSettings(ctx context.Context, providerID string) (LLMConfig, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return LLMConfig{}, err
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return LLMConfig{}, errors.New("providerIdを指定してください。")
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	if _, exists := stored[providerID]; !exists {
		return manager.GetLLMConfig(ctx)
	}
	delete(stored, providerID)
	if err := manager.saveStoredProviders(ctx, stored); err != nil {
		return LLMConfig{}, err
	}
	if err := manager.secrets.Delete(credentialService, apiKeyAccount(providerID)); err != nil {
		return LLMConfig{}, fmt.Errorf("delete %s API key: %w", providerID, err)
	}

	active, err := manager.loadActiveProviderID(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	if active == providerID {
		if err := manager.store.SaveSetting(ctx, llmActiveProviderKey, ""); err != nil {
			return LLMConfig{}, err
		}
		active = ""
	}
	return manager.buildConfig(active, stored)
}

// SetActiveProvider switches the currently active provider. The target must
// already exist in the stored config.
func (manager *Manager) SetActiveProvider(ctx context.Context, providerID string) (LLMConfig, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return LLMConfig{}, err
	}
	providerID = strings.TrimSpace(providerID)
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	if providerID != "" {
		if _, exists := stored[providerID]; !exists {
			return LLMConfig{}, fmt.Errorf("provider %s is not configured", providerID)
		}
	}
	if err := manager.store.SaveSetting(ctx, llmActiveProviderKey, providerID); err != nil {
		return LLMConfig{}, err
	}
	return manager.buildConfig(providerID, stored)
}

// Gateway resolves the active provider's config (and credential) each call so
// settings changes propagate without restarting the app.
func (manager *Manager) Gateway(ctx context.Context) (llm.Gateway, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return nil, err
	}
	active, err := manager.loadActiveProviderID(ctx)
	if err != nil {
		return nil, err
	}
	if active == "" {
		return nil, errors.New("LLM providerが選択されていません。")
	}
	descriptor, ok := manager.registry.Descriptor(llm.ProviderID(active))
	if !ok {
		return nil, fmt.Errorf("未知のproviderです: %s", active)
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return nil, err
	}
	entry, exists := stored[active]
	if !exists {
		return nil, fmt.Errorf("%sの設定が見つかりません。", descriptor.DisplayName)
	}
	cfg := llm.ProviderConfig{
		ProviderID:   llm.ProviderID(active),
		DisplayLabel: entry.DisplayLabel,
		Model:        entry.Model,
		Options:      entry.Options,
	}
	if err := manager.registry.Validate(cfg); err != nil {
		return nil, err
	}
	deps := llm.Deps{}
	if descriptor.RequiresAPIKey() {
		apiKey, err := manager.secrets.Get(credentialService, apiKeyAccount(active))
		if errors.Is(err, ErrSecretNotFound) {
			return nil, fmt.Errorf("%sのAPI keyを設定してください。", descriptor.DisplayName)
		}
		if err != nil {
			return nil, fmt.Errorf("read %s API key from credential store: %w", active, err)
		}
		deps.APIKey = apiKey
	}
	return manager.registry.Build(cfg, deps)
}

func (manager *Manager) buildConfig(active string, stored map[string]storedProvider) (LLMConfig, error) {
	descriptors := manager.registry.Descriptors()
	providers := make([]ProviderSettings, 0, len(stored))
	ids := make([]string, 0, len(stored))
	for id := range stored {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		entry := stored[id]
		descriptor, ok := manager.registry.Descriptor(llm.ProviderID(id))
		if !ok {
			continue
		}
		hasKey := false
		if descriptor.RequiresAPIKey() {
			_, err := manager.secrets.Get(credentialService, apiKeyAccount(id))
			if err == nil {
				hasKey = true
			} else if !errors.Is(err, ErrSecretNotFound) {
				return LLMConfig{}, fmt.Errorf("read %s API key from credential store: %w", id, err)
			}
		}
		cfg := llm.ProviderConfig{
			ProviderID:   llm.ProviderID(id),
			DisplayLabel: entry.DisplayLabel,
			Model:        entry.Model,
			Options:      entry.Options,
		}
		validationErr := manager.registry.Validate(cfg)
		configured := validationErr == nil && (!descriptor.RequiresAPIKey() || hasKey)
		providers = append(providers, ProviderSettings{
			ProviderID:   id,
			DisplayLabel: entry.DisplayLabel,
			Model:        entry.Model,
			Options:      entry.Options,
			HasAPIKey:    hasKey,
			Configured:   configured,
			IsActive:     id == active,
		})
	}
	return LLMConfig{
		ActiveProviderID: active,
		Providers:        providers,
		Catalog:          descriptors,
	}, nil
}

func (manager *Manager) loadActiveProviderID(ctx context.Context) (string, error) {
	value, err := manager.store.Setting(ctx, llmActiveProviderKey)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func (manager *Manager) loadStoredProviders(ctx context.Context) (map[string]storedProvider, error) {
	value, err := manager.store.Setting(ctx, llmProvidersKey)
	if err != nil {
		return nil, err
	}
	if value == "" {
		return map[string]storedProvider{}, nil
	}
	var stored map[string]storedProvider
	if err := json.Unmarshal([]byte(value), &stored); err != nil {
		return nil, fmt.Errorf("decode LLM provider settings: %w", err)
	}
	if stored == nil {
		stored = map[string]storedProvider{}
	}
	return stored, nil
}

func (manager *Manager) saveStoredProviders(ctx context.Context, stored map[string]storedProvider) error {
	data, err := json.Marshal(stored)
	if err != nil {
		return fmt.Errorf("encode LLM provider settings: %w", err)
	}
	return manager.store.SaveSetting(ctx, llmProvidersKey, string(data))
}

func normalizedOptions(options map[string]any) map[string]any {
	if len(options) == 0 {
		return nil
	}
	out := make(map[string]any, len(options))
	maps.Copy(out, options)
	return out
}

func apiKeyAccount(providerID string) string {
	return "llm." + providerID + ".api_key"
}
