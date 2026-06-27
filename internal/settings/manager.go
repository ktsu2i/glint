package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/kaito/glint/internal/llm"
	keyring "github.com/zalando/go-keyring"
)

const (
	credentialService = "com.glint.desktop"

	legacyLLMSettingKey      = "llm.openrouter"
	legacyOpenRouterKeyEntry = "openrouter-api-key"

	llmActiveProviderKey   = "llm.active_provider"
	llmActiveModelKey      = "llm.active_model_ref"
	llmProvidersKey        = "llm.providers"
	llmRecentProvidersKey  = "llm.recent_providers"
	llmRecentModelsKey     = "llm.recent_models"
	llmModelCachePrefix    = "llm.model_cache."
	llmMigrationDoneKey    = "llm.migration_v2_done"
	llmKeyCleanupDoneKey   = "llm.migration_v3_done"
	llmModelsMigrationKey  = "llm.migration_v4_done"
	llmOptionsMigrationKey = "llm.migration_v5_done"

	// recentProvidersLimit / recentModelsLimit は composer popover の RECENT
	// セクションに表示する最大件数。Zed の挙動に揃えて 3 件にしている。
	recentProvidersLimit = 3
	recentModelsLimit    = 3

	// modelListCacheTTL は listing API 結果を再利用する期間。spec の §10
	// (F10: default 24h) に合わせる。短期に上書きしたい場合は MockClock /
	// 設定で代替するが、第1段階では定数とする。
	modelListCacheTTL = 24 * time.Hour
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

// ActiveModelRef は frontend が現在 chat で使う (provider, model) の組。
// F10 で `llm.active_provider` 単独から拡張された。
type ActiveModelRef struct {
	ProviderID string `json:"providerId"`
	ModelID    string `json:"modelId"`
}

// CredentialSource は frontend に「現在 chat で使われる API key が
// どこから来ているか」を伝える。env 由来時はユーザーが Settings で見ている
// 値（keyring）と違う key が使われている可能性があるため、UI でバッジを
// 出して混乱を防ぐ。
type CredentialSource string

const (
	CredentialSourceNone    CredentialSource = "none"
	CredentialSourceKeyring CredentialSource = "keyring"
	CredentialSourceEnv     CredentialSource = "env"
)

// ProviderSettings は frontend へ返す1 provider 分の状態。secret 自体は含まない。
// F10 で `Model` (per-provider last-used) と `Models` (registered set) を分けた。
type ProviderSettings struct {
	ProviderID       string           `json:"providerId"`
	DisplayLabel     string           `json:"displayLabel,omitempty"`
	Model            string           `json:"model"`            // 直近に SetActiveModel で選ばれた model id（per-provider memory）
	Models           []string         `json:"models,omitempty"` // openai_compatible の手動登録 model id
	Options          map[string]any   `json:"options,omitempty"`
	HasAPIKey        bool             `json:"hasApiKey"`
	Configured       bool             `json:"configured"`
	IsActive         bool             `json:"isActive"`
	CredentialSource CredentialSource `json:"credentialSource"`
}

// LLMConfig は GetLLMConfig が返す top-level shape。
type LLMConfig struct {
	ActiveProviderID  string                   `json:"activeProviderId"`
	ActiveModel       *ActiveModelRef          `json:"activeModelRef,omitempty"`
	Providers         []ProviderSettings       `json:"providers"`
	Catalog           []llm.ProviderDescriptor `json:"catalog"`
	RecentProviderIDs []string                 `json:"recentProviderIds"`
	RecentModels      []ActiveModelRef         `json:"recentModels"`
}

// UpsertProviderRequest は frontend が provider 接続設定を upsert する時の入力。
// F10 で model / activate は削除し、provider 単位の接続情報（credential + options
// + label）だけを扱うようにした。model 選択は SetActiveModel が担当する。
type UpsertProviderRequest struct {
	ProviderID   string         `json:"providerId"`
	DisplayLabel string         `json:"displayLabel,omitempty"`
	Options      map[string]any `json:"options,omitempty"`
	APIKey       string         `json:"apiKey,omitempty"`
	ClearAPIKey  bool           `json:"clearApiKey,omitempty"`
}

type TestProviderConnectionResult struct {
	ProviderID string `json:"providerId"`
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
}

// ModelListingResult は ListProviderModels の戻り値。`source` は UI に
// 「API から取得した最新」「cache から復元」「fallback の builtin」を区別して
// 表示するために返す。
type ModelListingResult struct {
	ProviderID string                `json:"providerId"`
	Models     []llm.ModelDescriptor `json:"models"`
	Source     llm.ModelSource       `json:"source"`
	FetchedAt  *time.Time            `json:"fetchedAt,omitempty"`
	Error      string                `json:"error,omitempty"`
}

type storedProvider struct {
	DisplayLabel string         `json:"displayLabel,omitempty"`
	Model        string         `json:"model,omitempty"`
	Models       []string       `json:"models,omitempty"`
	Options      map[string]any `json:"options,omitempty"`
}

type storedModelCache struct {
	Models    []llm.ModelDescriptor `json:"models"`
	FetchedAt time.Time             `json:"fetchedAt"`
}

type Manager struct {
	store      SettingStore
	secrets    SecretStore
	registry   *llm.Registry
	listModels func(context.Context, llm.ProviderConfig, llm.Deps) ([]llm.ModelDescriptor, error)
	now        func() time.Time
	lookupEnv  func(string) (string, bool)
	migrated   bool
}

func NewManager(store SettingStore, secrets SecretStore) *Manager {
	registry := llm.NewRegistry()
	return &Manager{
		store:      store,
		secrets:    secrets,
		registry:   registry,
		listModels: registry.ListModels,
		now:        time.Now,
		lookupEnv:  os.LookupEnv,
	}
}

// GetLLMConfig returns the catalog plus every configured provider with their
// public state. Calls ensureMigration first so the result reflects the new
// schema even on first read after upgrade.
func (manager *Manager) GetLLMConfig(ctx context.Context) (LLMConfig, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return LLMConfig{}, err
	}
	active, err := manager.loadActiveModelRef(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	return manager.buildConfig(ctx, active, stored)
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
	_, ok := manager.registry.Descriptor(llm.ProviderID(providerID))
	if !ok {
		return LLMConfig{}, fmt.Errorf("未知のproviderです: %s", providerID)
	}
	if request.ClearAPIKey && strings.TrimSpace(request.APIKey) != "" {
		return LLMConfig{}, errors.New("API keyの更新と削除は同時に指定できません。")
	}

	cleanedLabel := strings.TrimSpace(request.DisplayLabel)
	cfg := llm.ProviderConfig{
		ProviderID:   llm.ProviderID(providerID),
		DisplayLabel: cleanedLabel,
		Options:      providerOptions(llm.ProviderID(providerID), request.Options),
	}
	if err := manager.registry.Validate(cfg); err != nil {
		return LLMConfig{}, err
	}

	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	previous := stored[providerID]
	stored[providerID] = storedProvider{
		DisplayLabel: cleanedLabel,
		Model:        previous.Model,  // F10: model は SetActiveModel 経由でだけ更新する
		Models:       previous.Models, // 既存の registered list は維持
		Options:      cfg.Options,
	}
	if err := manager.saveStoredProviders(ctx, stored); err != nil {
		return LLMConfig{}, err
	}

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

	active, err := manager.loadActiveModelRef(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	return manager.buildConfig(ctx, active, stored)
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
	// listing cache も provider が消えたら捨てる
	_ = manager.store.SaveSetting(ctx, llmModelCachePrefix+providerID, "")

	active, err := manager.loadActiveModelRef(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	if active != nil && active.ProviderID == providerID {
		if err := manager.clearActiveModelRef(ctx); err != nil {
			return LLMConfig{}, err
		}
		active = nil
	}
	return manager.buildConfig(ctx, active, stored)
}

// SetActiveProvider switches the currently active provider. The target must
// already exist in the stored config. The provider's last-used model becomes
// the active model; if none is recorded, the first known model is chosen.
func (manager *Manager) SetActiveProvider(ctx context.Context, providerID string) (LLMConfig, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return LLMConfig{}, err
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		if err := manager.clearActiveModelRef(ctx); err != nil {
			return LLMConfig{}, err
		}
		stored, err := manager.loadStoredProviders(ctx)
		if err != nil {
			return LLMConfig{}, err
		}
		return manager.buildConfig(ctx, nil, stored)
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	entry, exists := stored[providerID]
	if !exists {
		return LLMConfig{}, fmt.Errorf("provider %s is not configured", providerID)
	}
	modelID := strings.TrimSpace(entry.Model)
	if modelID == "" {
		modelID = manager.pickDefaultModelID(ctx, providerID, entry)
	}
	if modelID == "" {
		return LLMConfig{}, fmt.Errorf("%sに利用可能なmodelがありません。", providerID)
	}
	return manager.SetActiveModel(ctx, providerID, modelID)
}

// SetActiveModel records (providerId, modelId) as the active reference. The
// provider must already exist in the stored config. The chosen pair is also
// promoted in the recent-models LRU so the composer popover can surface it.
func (manager *Manager) SetActiveModel(ctx context.Context, providerID, modelID string) (LLMConfig, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return LLMConfig{}, err
	}
	providerID = strings.TrimSpace(providerID)
	modelID = strings.TrimSpace(modelID)
	if providerID == "" {
		return LLMConfig{}, errors.New("providerIdを指定してください。")
	}
	if modelID == "" {
		return LLMConfig{}, errors.New("modelIdを指定してください。")
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	entry, exists := stored[providerID]
	if !exists {
		return LLMConfig{}, fmt.Errorf("provider %s is not configured", providerID)
	}
	// per-provider last-used を更新する。
	entry.Model = modelID
	stored[providerID] = entry
	if err := manager.saveStoredProviders(ctx, stored); err != nil {
		return LLMConfig{}, err
	}
	ref := &ActiveModelRef{ProviderID: providerID, ModelID: modelID}
	if err := manager.saveActiveModelRef(ctx, ref); err != nil {
		return LLMConfig{}, err
	}
	if err := manager.touchRecentProvider(ctx, providerID); err != nil {
		return LLMConfig{}, err
	}
	if err := manager.touchRecentModel(ctx, *ref); err != nil {
		return LLMConfig{}, err
	}
	return manager.buildConfig(ctx, ref, stored)
}

// AddCustomModel registers a manual model id for a provider. Today this is
// only meaningful for openai_compatible providers, where no listing API is
// available. Built-in providers ignore the call gracefully so the UI can
// reuse the same code path without branching.
func (manager *Manager) AddCustomModel(ctx context.Context, providerID, modelID string) (LLMConfig, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return LLMConfig{}, err
	}
	providerID = strings.TrimSpace(providerID)
	modelID = strings.TrimSpace(modelID)
	if providerID == "" {
		return LLMConfig{}, errors.New("providerIdを指定してください。")
	}
	if modelID == "" {
		return LLMConfig{}, errors.New("modelIdを指定してください。")
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	entry, exists := stored[providerID]
	if !exists {
		return LLMConfig{}, fmt.Errorf("provider %s is not configured", providerID)
	}
	if slices.Contains(entry.Models, modelID) {
		return manager.GetLLMConfig(ctx)
	}
	entry.Models = append(entry.Models, modelID)
	stored[providerID] = entry
	if err := manager.saveStoredProviders(ctx, stored); err != nil {
		return LLMConfig{}, err
	}
	active, err := manager.loadActiveModelRef(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	return manager.buildConfig(ctx, active, stored)
}

// RemoveCustomModel deletes a manual model id from the provider's registered
// list. If the removed model was active, the active reference is cleared so
// the next chat send will surface a clear error and the UI can prompt.
func (manager *Manager) RemoveCustomModel(ctx context.Context, providerID, modelID string) (LLMConfig, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return LLMConfig{}, err
	}
	providerID = strings.TrimSpace(providerID)
	modelID = strings.TrimSpace(modelID)
	if providerID == "" {
		return LLMConfig{}, errors.New("providerIdを指定してください。")
	}
	if modelID == "" {
		return LLMConfig{}, errors.New("modelIdを指定してください。")
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	entry, exists := stored[providerID]
	if !exists {
		return manager.GetLLMConfig(ctx)
	}
	next := make([]string, 0, len(entry.Models))
	for _, existing := range entry.Models {
		if existing != modelID {
			next = append(next, existing)
		}
	}
	entry.Models = next
	if entry.Model == modelID {
		entry.Model = ""
	}
	stored[providerID] = entry
	if err := manager.saveStoredProviders(ctx, stored); err != nil {
		return LLMConfig{}, err
	}
	active, err := manager.loadActiveModelRef(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	if active != nil && active.ProviderID == providerID && active.ModelID == modelID {
		if err := manager.clearActiveModelRef(ctx); err != nil {
			return LLMConfig{}, err
		}
		active = nil
	}
	return manager.buildConfig(ctx, active, stored)
}

// ListProviderModels returns the model catalog for a provider, following the
// api → cache → builtin fallback order defined in §10 of the design doc. The
// returned `source` lets the UI render whether the list came from a fresh
// API hit, a cached response, or the Glint-managed seed list.
//
// When force=false (the default for the composer popover lazy load) we serve
// the cached listing first if it is still within modelListCacheTTL. This keeps
// short-interval calls from the composer popover from hitting upstream every
// time the popover opens. force=true (the explicit Refresh button) skips the
// cache and always tries the listing API first.
func (manager *Manager) ListProviderModels(ctx context.Context, providerID string, force bool) (ModelListingResult, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return ModelListingResult{}, err
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return ModelListingResult{}, errors.New("providerIdを指定してください。")
	}
	descriptor, ok := manager.registry.Descriptor(llm.ProviderID(providerID))
	if !ok {
		return ModelListingResult{}, fmt.Errorf("未知のproviderです: %s", providerID)
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return ModelListingResult{}, err
	}
	entry := stored[providerID]
	cfg := llm.ProviderConfig{
		ProviderID:   llm.ProviderID(providerID),
		DisplayLabel: entry.DisplayLabel,
		Options:      entry.Options,
	}
	deps := llm.Deps{}
	if providerRequiresAPIKey(descriptor, cfg) {
		apiKey, _, secretErr := manager.resolveAPIKey(providerID)
		if secretErr == nil {
			deps.APIKey = apiKey
		}
	}

	// Custom OpenAI-compatible は listing API を持たないため、
	// 手動登録 models[] のみが catalog になる。
	if llm.IsOpenAICompatibleID(llm.ProviderID(providerID)) {
		models := manualModels(entry.Models)
		return ModelListingResult{
			ProviderID: providerID,
			Models:     models,
			Source:     llm.ModelSourceBuiltin,
		}, nil
	}

	cached, cachedAt, cacheErr := manager.loadModelCache(ctx, providerID)
	cacheFresh := cacheErr == nil && len(cached) > 0 && manager.now().Sub(cachedAt) < modelListCacheTTL

	if manager.registry.HasListing(llm.ProviderID(providerID)) {
		// force=false で TTL 内の cache があれば、API hit をスキップして cache を返す。
		// composer popover を短い間隔で開閉しても上流に負荷を掛けないための短絡。
		if !force && cacheFresh {
			merged := append(cached, manualModels(entry.Models)...)
			return ModelListingResult{
				ProviderID: providerID,
				Models:     merged,
				Source:     llm.ModelSourceCache,
				FetchedAt:  pointer(cachedAt),
			}, nil
		}
		fresh, apiErr := manager.listModels(ctx, cfg, deps)
		if apiErr == nil && len(fresh) > 0 {
			merged := llm.MergeModels(fresh, llm.BuiltinModels(llm.ProviderID(providerID)))
			llm.SortModels(merged)
			fetched := manager.now()
			_ = manager.saveModelCache(ctx, providerID, merged, fetched)
			merged = append(merged, manualModels(entry.Models)...)
			return ModelListingResult{
				ProviderID: providerID,
				Models:     merged,
				Source:     llm.ModelSourceAPI,
				FetchedAt:  &fetched,
			}, nil
		}
		// API 失敗時は cache → builtin に fallback。フレッシュ判定はせず
		// 「ある cache をそのまま」表示する（spec: api → cache → builtin）。
		if cacheErr == nil && len(cached) > 0 {
			merged := append(cached, manualModels(entry.Models)...)
			return ModelListingResult{
				ProviderID: providerID,
				Models:     merged,
				Source:     llm.ModelSourceCache,
				FetchedAt:  pointer(cachedAt),
				Error:      apiErrorMessage(apiErr),
			}, nil
		}
		builtin := llm.BuiltinModels(llm.ProviderID(providerID))
		llm.SortModels(builtin)
		return ModelListingResult{
			ProviderID: providerID,
			Models:     append(builtin, manualModels(entry.Models)...),
			Source:     llm.ModelSourceBuiltin,
			Error:      apiErrorMessage(apiErr),
		}, nil
	}

	// listing API を持たない provider（Google 等）は cache → builtin の順だけ
	// 確認する。cache は API 由来なので、現状は実質 builtin のみとなる。
	if cacheFresh {
		merged := append(cached, manualModels(entry.Models)...)
		return ModelListingResult{
			ProviderID: providerID,
			Models:     merged,
			Source:     llm.ModelSourceCache,
			FetchedAt:  pointer(cachedAt),
		}, nil
	}
	builtin := llm.BuiltinModels(llm.ProviderID(providerID))
	llm.SortModels(builtin)
	return ModelListingResult{
		ProviderID: providerID,
		Models:     append(builtin, manualModels(entry.Models)...),
		Source:     llm.ModelSourceBuiltin,
	}, nil
}

// Gateway resolves the active provider's config (and credential) each call so
// settings changes propagate without restarting the app.
func (manager *Manager) Gateway(ctx context.Context) (llm.Gateway, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return nil, err
	}
	active, err := manager.loadActiveModelRef(ctx)
	if err != nil {
		return nil, err
	}
	if active == nil || active.ProviderID == "" || active.ModelID == "" {
		return nil, errors.New("LLM modelが選択されていません。")
	}
	return manager.gatewayForModel(ctx, active.ProviderID, active.ModelID)
}

// TestProviderConnection checks that the active model for a provider works.
// Today the test always uses the provider's last-used model so the result
// matches what chat would see right now.
func (manager *Manager) TestProviderConnection(ctx context.Context, providerID string) (TestProviderConnectionResult, error) {
	if err := manager.ensureMigration(ctx); err != nil {
		return TestProviderConnectionResult{}, err
	}
	providerID = strings.TrimSpace(providerID)
	result := TestProviderConnectionResult{ProviderID: providerID}
	if providerID == "" {
		result.Error = "providerIdを指定してください。"
		return result, nil
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return TestProviderConnectionResult{}, err
	}
	entry, exists := stored[providerID]
	if !exists {
		result.Error = fmt.Sprintf("%sの設定が見つかりません。", providerID)
		return result, nil
	}
	modelID := strings.TrimSpace(entry.Model)
	if modelID == "" {
		modelID = manager.pickDefaultModelID(ctx, providerID, entry)
	}
	if modelID == "" {
		result.Error = "テスト用のmodelを先に選択してください。"
		return result, nil
	}
	gateway, err := manager.gatewayForModel(ctx, providerID, modelID)
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}
	tester, ok := gateway.(llm.ConnectionTester)
	if !ok {
		result.Error = "このproviderは接続テストに対応していません。"
		return result, nil
	}
	testContext, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := tester.TestConnection(testContext); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			result.Error = "provider接続テストがタイムアウトしました。"
		} else {
			result.Error = err.Error()
		}
		return result, nil
	}
	result.OK = true
	return result, nil
}

func (manager *Manager) gatewayForModel(ctx context.Context, providerID, modelID string) (llm.Gateway, error) {
	descriptor, ok := manager.registry.Descriptor(llm.ProviderID(providerID))
	if !ok {
		return nil, fmt.Errorf("未知のproviderです: %s", providerID)
	}
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return nil, err
	}
	entry, exists := stored[providerID]
	if !exists {
		return nil, fmt.Errorf("%sの設定が見つかりません。", descriptor.DisplayName)
	}
	cfg := llm.ProviderConfig{
		ProviderID:   llm.ProviderID(providerID),
		DisplayLabel: entry.DisplayLabel,
		Model:        strings.TrimSpace(modelID),
		Options:      entry.Options,
	}
	if err := manager.registry.Validate(cfg); err != nil {
		return nil, err
	}
	deps := llm.Deps{
		Model: manager.resolveModelDescriptor(ctx, providerID, modelID),
	}
	if providerRequiresAPIKey(descriptor, cfg) {
		apiKey, source, err := manager.resolveAPIKey(providerID)
		if err != nil {
			return nil, fmt.Errorf("read %s API key from credential store: %w", providerID, err)
		}
		if source == CredentialSourceNone {
			return nil, fmt.Errorf("%sのAPI keyを設定してください。", descriptor.DisplayName)
		}
		deps.APIKey = apiKey
	}
	return manager.registry.Build(cfg, deps)
}

// resolveModelDescriptor looks up cached and built-in metadata for the model
// without performing any network I/O. Gateway construction must be fast, so we
// rely on the listing cache populated by ListProviderModels rather than hitting
// the upstream listing API on every chat request. Returns a zero descriptor
// when nothing matches, which falls through to FallbackBudget downstream.
func (manager *Manager) resolveModelDescriptor(ctx context.Context, providerID, modelID string) llm.ModelDescriptor {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return llm.ModelDescriptor{}
	}
	cached, _, _ := manager.loadModelCache(ctx, providerID)
	for _, model := range cached {
		if model.ID == modelID {
			return model
		}
	}
	for _, model := range llm.BuiltinModels(llm.ProviderID(providerID)) {
		if model.ID == modelID {
			return model
		}
	}
	return llm.ModelDescriptor{ID: modelID}
}

func (manager *Manager) buildConfig(ctx context.Context, active *ActiveModelRef, stored map[string]storedProvider) (LLMConfig, error) {
	descriptors := manager.registry.Descriptors()
	providers := make([]ProviderSettings, 0, len(stored))
	ids := make([]string, 0, len(stored))
	for id := range stored {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	recent, err := manager.loadRecentProviders(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	recent = pruneRecentProviders(recent, stored)
	recentModels, err := manager.loadRecentModels(ctx)
	if err != nil {
		return LLMConfig{}, err
	}
	recentModels = pruneRecentModels(recentModels, stored)

	activeProviderID := ""
	if active != nil {
		activeProviderID = active.ProviderID
	}
	for _, id := range ids {
		entry := stored[id]
		descriptor, ok := manager.registry.Descriptor(llm.ProviderID(id))
		if !ok {
			continue
		}
		cfg := llm.ProviderConfig{
			ProviderID:   llm.ProviderID(id),
			DisplayLabel: entry.DisplayLabel,
			Model:        entry.Model,
			Options:      entry.Options,
		}
		hasKey := false
		source := CredentialSourceNone
		if providerRequiresAPIKey(descriptor, cfg) {
			_, resolvedSource, err := manager.resolveAPIKey(id)
			if err != nil {
				return LLMConfig{}, fmt.Errorf("read %s API key from credential store: %w", id, err)
			}
			source = resolvedSource
			if resolvedSource != CredentialSourceNone {
				hasKey = true
			}
		}
		validationErr := manager.registry.Validate(cfg)
		requiresAPIKey := providerRequiresAPIKey(descriptor, cfg)
		configured := validationErr == nil && (!requiresAPIKey || hasKey)
		// openai_compatible は手動登録 model が無いと「chat に投げられる」状態にならない。
		if llm.IsOpenAICompatibleID(cfg.ProviderID) && len(entry.Models) == 0 && strings.TrimSpace(entry.Model) == "" {
			configured = false
		}
		providers = append(providers, ProviderSettings{
			ProviderID:       id,
			DisplayLabel:     entry.DisplayLabel,
			Model:            entry.Model,
			Models:           append([]string(nil), entry.Models...),
			Options:          entry.Options,
			HasAPIKey:        hasKey,
			Configured:       configured,
			IsActive:         id == activeProviderID,
			CredentialSource: source,
		})
	}
	return LLMConfig{
		ActiveProviderID:  activeProviderID,
		ActiveModel:       active,
		Providers:         providers,
		Catalog:           descriptors,
		RecentProviderIDs: recent,
		RecentModels:      recentModels,
	}, nil
}

// pickDefaultModelID は SetActiveProvider が呼ばれたときに、ユーザーが過去に
// 選んだ model が無ければ provider の既知 model から1つ選んで返す。listing と
// builtin のどちらでも構わない。manual models を持つ openai_compatible は
// それを優先する。
func (manager *Manager) pickDefaultModelID(ctx context.Context, providerID string, entry storedProvider) string {
	if id := strings.TrimSpace(entry.Model); id != "" {
		return id
	}
	if len(entry.Models) > 0 {
		return entry.Models[0]
	}
	listing, err := manager.ListProviderModels(ctx, providerID, false)
	if err == nil && len(listing.Models) > 0 {
		return listing.Models[0].ID
	}
	builtin := llm.BuiltinModels(llm.ProviderID(providerID))
	if len(builtin) > 0 {
		return builtin[0].ID
	}
	return ""
}

func (manager *Manager) loadActiveProviderID(ctx context.Context) (string, error) {
	value, err := manager.store.Setting(ctx, llmActiveProviderKey)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func (manager *Manager) loadActiveModelRef(ctx context.Context) (*ActiveModelRef, error) {
	value, err := manager.store.Setting(ctx, llmActiveModelKey)
	if err != nil {
		return nil, err
	}
	value = strings.TrimSpace(value)
	if value == "" {
		// v4 migration が走った直後は providerKey も同期されている。
		legacy, legacyErr := manager.loadActiveProviderID(ctx)
		if legacyErr != nil {
			return nil, legacyErr
		}
		if legacy == "" {
			return nil, nil
		}
		stored, storedErr := manager.loadStoredProviders(ctx)
		if storedErr != nil {
			return nil, storedErr
		}
		entry, exists := stored[legacy]
		if !exists {
			return nil, nil
		}
		model := strings.TrimSpace(entry.Model)
		if model == "" {
			return nil, nil
		}
		return &ActiveModelRef{ProviderID: legacy, ModelID: model}, nil
	}
	var ref ActiveModelRef
	if err := json.Unmarshal([]byte(value), &ref); err != nil {
		return nil, fmt.Errorf("decode active model ref: %w", err)
	}
	if strings.TrimSpace(ref.ProviderID) == "" || strings.TrimSpace(ref.ModelID) == "" {
		return nil, nil
	}
	return &ref, nil
}

func (manager *Manager) saveActiveModelRef(ctx context.Context, ref *ActiveModelRef) error {
	if ref == nil {
		return manager.clearActiveModelRef(ctx)
	}
	encoded, err := json.Marshal(ref)
	if err != nil {
		return fmt.Errorf("encode active model ref: %w", err)
	}
	if err := manager.store.SaveSetting(ctx, llmActiveModelKey, string(encoded)); err != nil {
		return err
	}
	// 旧 key も同期して frontend / migration の早期 read を安全にする。
	return manager.store.SaveSetting(ctx, llmActiveProviderKey, ref.ProviderID)
}

func (manager *Manager) clearActiveModelRef(ctx context.Context) error {
	if err := manager.store.SaveSetting(ctx, llmActiveModelKey, ""); err != nil {
		return err
	}
	return manager.store.SaveSetting(ctx, llmActiveProviderKey, "")
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

func (manager *Manager) loadRecentProviders(ctx context.Context) ([]string, error) {
	value, err := manager.store.Setting(ctx, llmRecentProvidersKey)
	if err != nil {
		return nil, err
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	var recent []string
	if err := json.Unmarshal([]byte(value), &recent); err != nil {
		return nil, fmt.Errorf("decode LLM recent providers: %w", err)
	}
	return recent, nil
}

func (manager *Manager) saveRecentProviders(ctx context.Context, recent []string) error {
	data, err := json.Marshal(recent)
	if err != nil {
		return fmt.Errorf("encode LLM recent providers: %w", err)
	}
	return manager.store.SaveSetting(ctx, llmRecentProvidersKey, string(data))
}

func (manager *Manager) loadRecentModels(ctx context.Context) ([]ActiveModelRef, error) {
	value, err := manager.store.Setting(ctx, llmRecentModelsKey)
	if err != nil {
		return nil, err
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	var recent []ActiveModelRef
	if err := json.Unmarshal([]byte(value), &recent); err != nil {
		return nil, fmt.Errorf("decode LLM recent models: %w", err)
	}
	return recent, nil
}

func (manager *Manager) saveRecentModels(ctx context.Context, recent []ActiveModelRef) error {
	data, err := json.Marshal(recent)
	if err != nil {
		return fmt.Errorf("encode LLM recent models: %w", err)
	}
	return manager.store.SaveSetting(ctx, llmRecentModelsKey, string(data))
}

// touchRecentProvider moves providerID to the front of the LRU list and
// trims it to recentProvidersLimit.
func (manager *Manager) touchRecentProvider(ctx context.Context, providerID string) error {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return nil
	}
	current, err := manager.loadRecentProviders(ctx)
	if err != nil {
		return err
	}
	next := make([]string, 0, len(current)+1)
	next = append(next, providerID)
	for _, id := range current {
		if id == providerID {
			continue
		}
		next = append(next, id)
		if len(next) == recentProvidersLimit {
			break
		}
	}
	return manager.saveRecentProviders(ctx, next)
}

// touchRecentModel moves a (providerId, modelId) pair to the front of the LRU.
func (manager *Manager) touchRecentModel(ctx context.Context, ref ActiveModelRef) error {
	if strings.TrimSpace(ref.ProviderID) == "" || strings.TrimSpace(ref.ModelID) == "" {
		return nil
	}
	current, err := manager.loadRecentModels(ctx)
	if err != nil {
		return err
	}
	next := make([]ActiveModelRef, 0, len(current)+1)
	next = append(next, ref)
	for _, entry := range current {
		if entry.ProviderID == ref.ProviderID && entry.ModelID == ref.ModelID {
			continue
		}
		next = append(next, entry)
		if len(next) == recentModelsLimit {
			break
		}
	}
	return manager.saveRecentModels(ctx, next)
}

func (manager *Manager) loadModelCache(ctx context.Context, providerID string) ([]llm.ModelDescriptor, time.Time, error) {
	value, err := manager.store.Setting(ctx, llmModelCachePrefix+providerID)
	if err != nil {
		return nil, time.Time{}, err
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, time.Time{}, nil
	}
	var cached storedModelCache
	if err := json.Unmarshal([]byte(value), &cached); err != nil {
		return nil, time.Time{}, fmt.Errorf("decode model cache for %s: %w", providerID, err)
	}
	return cached.Models, cached.FetchedAt, nil
}

func (manager *Manager) saveModelCache(ctx context.Context, providerID string, models []llm.ModelDescriptor, fetchedAt time.Time) error {
	data, err := json.Marshal(storedModelCache{Models: models, FetchedAt: fetchedAt})
	if err != nil {
		return fmt.Errorf("encode model cache for %s: %w", providerID, err)
	}
	return manager.store.SaveSetting(ctx, llmModelCachePrefix+providerID, string(data))
}

// pruneRecentProviders drops entries that no longer have a stored config so
// the frontend never references a vanished provider.
func pruneRecentProviders(recent []string, stored map[string]storedProvider) []string {
	if len(recent) == 0 {
		return nil
	}
	out := make([]string, 0, len(recent))
	for _, id := range recent {
		if _, exists := stored[id]; exists {
			out = append(out, id)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func pruneRecentModels(recent []ActiveModelRef, stored map[string]storedProvider) []ActiveModelRef {
	if len(recent) == 0 {
		return nil
	}
	out := make([]ActiveModelRef, 0, len(recent))
	for _, ref := range recent {
		if _, exists := stored[ref.ProviderID]; exists {
			out = append(out, ref)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func manualModels(modelIDs []string) []llm.ModelDescriptor {
	if len(modelIDs) == 0 {
		return nil
	}
	out := make([]llm.ModelDescriptor, 0, len(modelIDs))
	for _, id := range modelIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			continue
		}
		out = append(out, llm.ModelDescriptor{
			ID:     trimmed,
			Source: llm.ModelSourceBuiltin,
		})
	}
	return out
}

func normalizedOptions(options map[string]any) map[string]any {
	if len(options) == 0 {
		return nil
	}
	out := make(map[string]any, len(options))
	maps.Copy(out, options)
	return out
}

// providerOptions keeps endpoint-level configuration exclusive to explicit
// Custom OpenAI-compatible providers. Built-in provider behavior is versioned
// in its adapter, so accepting options here would recreate hidden settings
// that the Settings UI can no longer inspect or correct.
func providerOptions(providerID llm.ProviderID, options map[string]any) map[string]any {
	if !llm.IsOpenAICompatibleID(providerID) {
		return nil
	}
	return normalizedOptions(options)
}

func apiKeyAccount(providerID string) string {
	return "llm." + providerID + ".api_key"
}

// envVarNameFor returns the env var name that overrides the keyring API key
// for the given provider. openai_compatible:<slug> maps to
// GLINT_OPENAI_COMPATIBLE_<UPPER_SLUG>_API_KEY (slug `-` becomes `_`). The
// bare template id `openai_compatible` is rejected because it never represents
// a real configured provider.
func envVarNameFor(providerID string) string {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" || providerID == string(llm.ProviderOpenAICompatible) {
		return ""
	}
	if llm.IsOpenAICompatibleID(llm.ProviderID(providerID)) {
		slug := llm.OpenAICompatibleSlug(llm.ProviderID(providerID))
		if slug == "" {
			return ""
		}
		normalized := strings.ToUpper(strings.ReplaceAll(slug, "-", "_"))
		return "GLINT_OPENAI_COMPATIBLE_" + normalized + "_API_KEY"
	}
	return "GLINT_" + strings.ToUpper(providerID) + "_API_KEY"
}

// resolveAPIKey returns the API key for a provider, preferring the env var
// override over the keyring entry. The boolean indicates whether a key was
// found at all; the CredentialSource tells callers which storage produced it
// so the UI can warn about env-driven overrides.
func (manager *Manager) resolveAPIKey(providerID string) (string, CredentialSource, error) {
	if envName := envVarNameFor(providerID); envName != "" && manager.lookupEnv != nil {
		if value, ok := manager.lookupEnv(envName); ok {
			value = strings.TrimSpace(value)
			if value != "" {
				return value, CredentialSourceEnv, nil
			}
		}
	}
	value, err := manager.secrets.Get(credentialService, apiKeyAccount(providerID))
	if errors.Is(err, ErrSecretNotFound) {
		return "", CredentialSourceNone, nil
	}
	if err != nil {
		return "", CredentialSourceNone, err
	}
	if strings.TrimSpace(value) == "" {
		return "", CredentialSourceNone, nil
	}
	return value, CredentialSourceKeyring, nil
}

func providerRequiresAPIKey(descriptor llm.ProviderDescriptor, cfg llm.ProviderConfig) bool {
	if llm.IsOpenAICompatibleID(cfg.ProviderID) {
		value, exists := cfg.Options["requires_api_key"]
		if !exists {
			return true
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			normalized := strings.ToLower(strings.TrimSpace(typed))
			return normalized != "false" && normalized != "0" && normalized != "no"
		}
	}
	return descriptor.RequiresAPIKey()
}

func pointer[T any](value T) *T { return &value }

func apiErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
