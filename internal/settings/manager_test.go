package settings

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kaito/glint/internal/llm"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type memorySettingStore struct{ values map[string]string }

func (store *memorySettingStore) Setting(_ context.Context, key string) (string, error) {
	return store.values[key], nil
}

func (store *memorySettingStore) SaveSetting(_ context.Context, key, value string) error {
	store.values[key] = value
	return nil
}

type memorySecretStore struct{ values map[string]string }

func secretKey(service, account string) string { return service + ":" + account }

func (store *memorySecretStore) Get(service, account string) (string, error) {
	value, ok := store.values[secretKey(service, account)]
	if !ok {
		return "", ErrSecretNotFound
	}
	return value, nil
}

func (store *memorySecretStore) Set(service, account, value string) error {
	store.values[secretKey(service, account)] = value
	return nil
}

func (store *memorySecretStore) Delete(service, account string) error {
	delete(store.values, secretKey(service, account))
	return nil
}

func newTestManager() (*Manager, *memorySettingStore, *memorySecretStore) {
	settingsStore := &memorySettingStore{values: map[string]string{}}
	secretStore := &memorySecretStore{values: map[string]string{}}
	return NewManager(settingsStore, secretStore), settingsStore, secretStore
}

func openRouterAccount() string { return secretKey(credentialService, apiKeyAccount("openrouter")) }

func TestGetLLMConfigReturnsEmptyButCatalogOnFreshInstall(t *testing.T) {
	manager, _, _ := newTestManager()
	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "", config.ActiveProviderID)
	assert.Nil(t, config.ActiveModel)
	assert.Empty(t, config.Providers)
	require.NotEmpty(t, config.Catalog)
	ids := make([]string, 0, len(config.Catalog))
	for _, descriptor := range config.Catalog {
		ids = append(ids, string(descriptor.ID))
	}
	assert.Contains(t, ids, "openrouter")
	assert.Contains(t, ids, "openai")
	assert.Contains(t, ids, "ollama")
	assert.Contains(t, ids, "openai_compatible")
}

func TestUpsertProviderPersistsConfigAndCredentialSeparately(t *testing.T) {
	manager, settingStore, secretStore := newTestManager()
	config, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter",
		Options:    map[string]any{"zdr": true},
		APIKey:     " secret-value ",
	})
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	provider := config.Providers[0]
	assert.True(t, provider.HasAPIKey)
	assert.True(t, provider.Configured, "openrouter should be configured once API key is saved")
	assert.False(t, provider.IsActive, "upsert alone never activates a provider in F10")
	assert.Equal(t, "", config.ActiveProviderID)
	assert.Empty(t, provider.Options, "built-in options must not be persisted")

	assert.NotContains(t, settingStore.values[llmProvidersKey], "secret-value")
	assert.Equal(t, "secret-value", secretStore.values[openRouterAccount()])

	// Selecting an active (provider, model) is what wires the chat path up.
	next, err := manager.SetActiveModel(context.Background(), "openrouter", "anthropic/claude-sonnet-4-6")
	require.NoError(t, err)
	require.NotNil(t, next.ActiveModel)
	assert.Equal(t, "openrouter", next.ActiveModel.ProviderID)
	assert.Equal(t, "anthropic/claude-sonnet-4-6", next.ActiveModel.ModelID)

	_, err = manager.Gateway(context.Background())
	require.NoError(t, err)
}

func TestUpsertWithoutAPIKeyKeepsExistingCredential(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", Options: map[string]any{"zdr": true}, APIKey: "secret",
	})
	require.NoError(t, err)

	config, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", Options: map[string]any{"zdr": false},
	})
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.True(t, config.Providers[0].HasAPIKey)
	assert.Empty(t, config.Providers[0].Options)
}

func TestUpsertClearAPIKeyRemovesCredentialButKeepsConfig(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", APIKey: "secret",
	})
	require.NoError(t, err)
	_, err = manager.SetActiveModel(context.Background(), "openrouter", "anthropic/claude-sonnet-4-6")
	require.NoError(t, err)

	config, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", ClearAPIKey: true,
	})
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.False(t, config.Providers[0].HasAPIKey)
	assert.False(t, config.Providers[0].Configured)

	_, err = manager.Gateway(context.Background())
	assert.ErrorContains(t, err, "API key")
}

func TestUpsertValidatesProviderConfig(t *testing.T) {
	manager, _, _ := newTestManager()

	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", APIKey: "new", ClearAPIKey: true,
	})
	assert.ErrorContains(t, err, "同時")

	_, err = manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{ProviderID: "no-such-provider"})
	assert.ErrorContains(t, err, "未知")
}

func TestDeleteProviderRemovesConfigAndCredential(t *testing.T) {
	manager, _, secretStore := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", APIKey: "secret",
	})
	require.NoError(t, err)

	config, err := manager.DeleteProviderSettings(context.Background(), "openrouter")
	require.NoError(t, err)
	assert.Empty(t, config.Providers)
	assert.Equal(t, "", config.ActiveProviderID)
	_, exists := secretStore.values[openRouterAccount()]
	assert.False(t, exists)
}

func TestSetActiveProviderRejectsUnknownAndClears(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", APIKey: "secret",
	})
	require.NoError(t, err)

	_, err = manager.SetActiveProvider(context.Background(), "unknown")
	assert.ErrorContains(t, err, "unknown is not configured")

	cleared, err := manager.SetActiveProvider(context.Background(), "")
	require.NoError(t, err)
	assert.Equal(t, "", cleared.ActiveProviderID)
	assert.Nil(t, cleared.ActiveModel)
}

func TestSetActiveModelTracksRecentProvidersAsLRU(t *testing.T) {
	manager, settingStore, _ := newTestManager()
	for _, request := range []UpsertProviderRequest{
		{ProviderID: "openrouter", APIKey: "k1"},
		{ProviderID: "openai", APIKey: "k2"},
		{ProviderID: "anthropic", APIKey: "k3"},
		{ProviderID: "ollama"},
	} {
		_, err := manager.UpsertProviderSettings(context.Background(), request)
		require.NoError(t, err)
	}

	first, err := manager.SetActiveModel(context.Background(), "openrouter", "anthropic/claude-sonnet-4-6")
	require.NoError(t, err)
	assert.Equal(t, []string{"openrouter"}, first.RecentProviderIDs)
	require.NotNil(t, first.ActiveModel)
	assert.Equal(t, "anthropic/claude-sonnet-4-6", first.ActiveModel.ModelID)

	second, err := manager.SetActiveModel(context.Background(), "openai", "gpt-5")
	require.NoError(t, err)
	assert.Equal(t, []string{"openai", "openrouter"}, second.RecentProviderIDs)

	// Re-activating openrouter promotes it back to the front without growing
	// the list, proving the LRU updates rather than appends duplicates.
	third, err := manager.SetActiveModel(context.Background(), "openrouter", "anthropic/claude-sonnet-4-6")
	require.NoError(t, err)
	assert.Equal(t, []string{"openrouter", "openai"}, third.RecentProviderIDs)

	// Adding two more entries pushes the oldest out so the window stays at 3.
	_, err = manager.SetActiveModel(context.Background(), "anthropic", "claude-opus-4-8")
	require.NoError(t, err)
	final, err := manager.SetActiveModel(context.Background(), "ollama", "llama3")
	require.NoError(t, err)
	assert.Equal(t, []string{"ollama", "anthropic", "openrouter"}, final.RecentProviderIDs)

	// SQLite persistence proves the LRU survives a process restart.
	assert.JSONEq(t, `["ollama","anthropic","openrouter"]`, settingStore.values[llmRecentProvidersKey])

	// A fresh Manager (same store) reproduces the same recent list, as expected
	// after re-mounting the frontend.
	reborn := NewManager(settingStore, &memorySecretStore{values: map[string]string{}})
	reloaded, err := reborn.GetLLMConfig(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []string{"ollama", "anthropic", "openrouter"}, reloaded.RecentProviderIDs)
}

func TestRecentProvidersPruneDroppedEntries(t *testing.T) {
	manager, _, _ := newTestManager()
	for _, request := range []UpsertProviderRequest{
		{ProviderID: "openrouter", APIKey: "k1"},
		{ProviderID: "openai", APIKey: "k2"},
	} {
		_, err := manager.UpsertProviderSettings(context.Background(), request)
		require.NoError(t, err)
	}
	_, err := manager.SetActiveModel(context.Background(), "openrouter", "anthropic/claude-sonnet-4-6")
	require.NoError(t, err)
	_, err = manager.SetActiveModel(context.Background(), "openai", "gpt-5")
	require.NoError(t, err)

	// Deleting openrouter must drop it from the recent list so the composer
	// never tries to switch to a vanished provider.
	config, err := manager.DeleteProviderSettings(context.Background(), "openrouter")
	require.NoError(t, err)
	assert.Equal(t, []string{"openai"}, config.RecentProviderIDs)
}

func TestRecentModelsLRUTracksPairs(t *testing.T) {
	manager, _, _ := newTestManager()
	for _, request := range []UpsertProviderRequest{
		{ProviderID: "openrouter", APIKey: "k1"},
		{ProviderID: "openai", APIKey: "k2"},
	} {
		_, err := manager.UpsertProviderSettings(context.Background(), request)
		require.NoError(t, err)
	}
	_, err := manager.SetActiveModel(context.Background(), "openrouter", "anthropic/claude-sonnet-4-6")
	require.NoError(t, err)
	_, err = manager.SetActiveModel(context.Background(), "openai", "gpt-5")
	require.NoError(t, err)
	final, err := manager.SetActiveModel(context.Background(), "openrouter", "openai/gpt-5")
	require.NoError(t, err)

	// 同じ provider でも model id が違えば別エントリとして残る。
	expected := []ActiveModelRef{
		{ProviderID: "openrouter", ModelID: "openai/gpt-5"},
		{ProviderID: "openai", ModelID: "gpt-5"},
		{ProviderID: "openrouter", ModelID: "anthropic/claude-sonnet-4-6"},
	}
	assert.Equal(t, expected, final.RecentModels)
}

func TestMigrationCopiesLegacyOpenRouterIntoNewSchema(t *testing.T) {
	manager, settingStore, secretStore := newTestManager()
	settingStore.values[legacyLLMSettingKey] = `{"provider":"openrouter","model":"provider/legacy","zdr":true}`
	secretStore.values[secretKey(credentialService, legacyOpenRouterKeyEntry)] = "legacy-key"

	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.Equal(t, "openrouter", config.Providers[0].ProviderID)
	assert.Equal(t, "provider/legacy", config.Providers[0].Model)
	assert.True(t, config.Providers[0].HasAPIKey)
	assert.True(t, config.Providers[0].IsActive)
	assert.Equal(t, "openrouter", config.ActiveProviderID)
	require.NotNil(t, config.ActiveModel)
	assert.Equal(t, "openrouter", config.ActiveModel.ProviderID)
	assert.Equal(t, "provider/legacy", config.ActiveModel.ModelID)
	assert.Equal(t, "legacy-key", secretStore.values[openRouterAccount()])
	_, legacyExists := secretStore.values[secretKey(credentialService, legacyOpenRouterKeyEntry)]
	assert.False(t, legacyExists)
	assert.Equal(t, "1", settingStore.values[llmMigrationDoneKey])
	assert.Equal(t, "1", settingStore.values[llmKeyCleanupDoneKey])
	assert.Equal(t, "1", settingStore.values[llmModelsMigrationKey])
	assert.Equal(t, "1", settingStore.values[llmOptionsMigrationKey])
}

func TestMigrationIsIdempotent(t *testing.T) {
	manager, settingStore, _ := newTestManager()
	settingStore.values[legacyLLMSettingKey] = `{"provider":"openrouter","model":"provider/legacy","zdr":false}`

	_, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)

	// Manually flip the migration done flag off to verify the short-circuit works
	// after a second invocation.
	delete(settingStore.values, llmMigrationDoneKey)
	manager.migrated = false
	_, err = manager.GetLLMConfig(context.Background())
	require.NoError(t, err)

	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
}

func TestMigrationV4PromotesActiveProviderToActiveModelRef(t *testing.T) {
	manager, settingStore, _ := newTestManager()
	settingStore.values[llmMigrationDoneKey] = "1"
	settingStore.values[llmKeyCleanupDoneKey] = "1"
	settingStore.values[llmProvidersKey] = `{"openai":{"model":"gpt-5","options":{}}}`
	settingStore.values[llmActiveProviderKey] = "openai"

	_, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "1", settingStore.values[llmModelsMigrationKey])

	// active_model_ref が JSON で保存されている。
	require.NotEmpty(t, settingStore.values[llmActiveModelKey])
	var ref ActiveModelRef
	require.NoError(t, json.Unmarshal([]byte(settingStore.values[llmActiveModelKey]), &ref))
	assert.Equal(t, "openai", ref.ProviderID)
	assert.Equal(t, "gpt-5", ref.ModelID)

	// 旧 model 単独保存は models[] の先頭にも入れる。
	stored, err := manager.loadStoredProviders(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-5"}, stored["openai"].Models)
}

func TestMigrationV4IsIdempotent(t *testing.T) {
	manager, settingStore, _ := newTestManager()
	settingStore.values[llmMigrationDoneKey] = "1"
	settingStore.values[llmKeyCleanupDoneKey] = "1"
	settingStore.values[llmProvidersKey] = `{"openai":{"model":"gpt-5"}}`
	settingStore.values[llmActiveProviderKey] = "openai"

	_, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	first := settingStore.values[llmActiveModelKey]

	// 2回目の起動でも結果が変わらない。
	manager.migrated = false
	_, err = manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	assert.Equal(t, first, settingStore.values[llmActiveModelKey])
}

func TestMigrationCleansLegacyKeyForPreviouslyMigratedInstall(t *testing.T) {
	manager, settingStore, secretStore := newTestManager()
	settingStore.values[llmMigrationDoneKey] = "1"
	settingStore.values[llmProvidersKey] = `{"openrouter":{"model":"provider/model","options":{"zdr":true}}}`
	settingStore.values[llmActiveProviderKey] = "openrouter"
	secretStore.values[secretKey(credentialService, legacyOpenRouterKeyEntry)] = "legacy-key"

	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.Equal(t, "legacy-key", secretStore.values[openRouterAccount()])
	_, legacyExists := secretStore.values[secretKey(credentialService, legacyOpenRouterKeyEntry)]
	assert.False(t, legacyExists)
	assert.Equal(t, "1", settingStore.values[llmKeyCleanupDoneKey])
}

func TestManagerSurfacesCredentialFailures(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", APIKey: "secret",
	})
	require.NoError(t, err)
	manager.secrets = failingSecretStore{}
	_, err = manager.GetLLMConfig(context.Background())
	assert.Error(t, err)
}

func TestUpsertOllamaDoesNotRequireAPIKey(t *testing.T) {
	manager, _, _ := newTestManager()
	config, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "ollama",
		Options:    map[string]any{"base_url": "http://localhost:11434/v1"},
	})
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.Equal(t, "ollama", config.Providers[0].ProviderID)
	assert.False(t, config.Providers[0].HasAPIKey)
	assert.True(t, config.Providers[0].Configured)
	assert.False(t, config.Providers[0].IsActive)

	_, err = manager.SetActiveModel(context.Background(), "ollama", "llama3")
	require.NoError(t, err)
	gateway, err := manager.Gateway(context.Background())
	require.NoError(t, err)
	_, ok := gateway.(*llm.OllamaGateway)
	assert.True(t, ok)
}

func TestUpsertOpenAIIgnoresLegacyOptions(t *testing.T) {
	manager, settingStore, secretStore := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai",
		Options:    map[string]any{"organization": "org_abc"},
		APIKey:     "sk-secret",
	})
	require.NoError(t, err)

	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.Equal(t, "openai", config.Providers[0].ProviderID)
	assert.Empty(t, config.Providers[0].Options)
	assert.True(t, config.Providers[0].HasAPIKey)
	assert.NotContains(t, settingStore.values[llmProvidersKey], "sk-secret")
	assert.Equal(t, "sk-secret", secretStore.values[secretKey(credentialService, "llm.openai.api_key")])
}

func TestMigrationV5RemovesOnlyBuiltInProviderOptions(t *testing.T) {
	manager, settingStore, secretStore := newTestManager()
	settingStore.values[llmMigrationDoneKey] = "1"
	settingStore.values[llmKeyCleanupDoneKey] = "1"
	settingStore.values[llmModelsMigrationKey] = "1"
	settingStore.values[llmProvidersKey] = `{
		"openrouter":{"model":"openai/gpt-5","models":["openai/gpt-5"],"options":{"zdr":false}},
		"openai":{"model":"gpt-5","models":["gpt-5"],"options":{"base_url":"https://legacy.example.com","organization":"org_legacy"}},
		"anthropic":{"model":"claude-sonnet-4-6","models":["claude-sonnet-4-6"],"options":{"base_url":"https://legacy.example.com","anthropic_version":"2099-01-01"}},
		"google":{"model":"gemini-2.5-pro","models":["gemini-2.5-pro"],"options":{"base_url":"https://legacy.example.com","api_version":"v1","auth_mode":"query"}},
		"ollama":{"model":"llama3","models":["llama3"],"options":{"base_url":"http://legacy.example.com/v1","keep_alive":"5m"}},
		"openai_compatible:local":{"displayLabel":"Local","model":"custom","models":["custom"],"options":{"base_url":"http://localhost:8080/v1","requires_api_key":false,"headers":{"X-Tenant":"dev"}}}
	}`
	settingStore.values[llmActiveModelKey] = `{"providerId":"openai","modelId":"gpt-5"}`
	settingStore.values[llmRecentModelsKey] = `[{"providerId":"openai","modelId":"gpt-5"}]`
	secretStore.values[secretKey(credentialService, apiKeyAccount("openai"))] = "sk-preserved"

	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "1", settingStore.values[llmOptionsMigrationKey])
	require.NotNil(t, config.ActiveModel)
	assert.Equal(t, ActiveModelRef{ProviderID: "openai", ModelID: "gpt-5"}, *config.ActiveModel)
	assert.Equal(t, []ActiveModelRef{{ProviderID: "openai", ModelID: "gpt-5"}}, config.RecentModels)
	assert.Equal(t, "sk-preserved", secretStore.values[secretKey(credentialService, apiKeyAccount("openai"))])

	stored, err := manager.loadStoredProviders(context.Background())
	require.NoError(t, err)
	for _, id := range []string{"openrouter", "openai", "anthropic", "google", "ollama"} {
		assert.Empty(t, stored[id].Options, "%s legacy options must be removed", id)
	}
	assert.Equal(t, map[string]any{
		"base_url":         "http://localhost:8080/v1",
		"requires_api_key": false,
		"headers":          map[string]any{"X-Tenant": "dev"},
	}, stored["openai_compatible:local"].Options)

	first := settingStore.values[llmProvidersKey]
	manager.migrated = false
	_, err = manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	assert.Equal(t, first, settingStore.values[llmProvidersKey], "migration must be idempotent")
}

func TestUpsertOpenAICompatibleRequiresSlug(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai_compatible",
		Options:    map[string]any{"base_url": "https://api.groq.com/openai/v1"},
		APIKey:     "secret",
	})
	assert.ErrorContains(t, err, "openai_compatible:")
}

func TestUpsertOpenAICompatibleStoresSlugInstance(t *testing.T) {
	manager, _, secretStore := newTestManager()
	config, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID:   "openai_compatible:groq",
		DisplayLabel: "Groq",
		Options: map[string]any{
			"base_url":         "https://api.groq.com/openai/v1",
			"requires_api_key": true,
		},
		APIKey: "secret",
	})
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.Equal(t, "openai_compatible:groq", config.Providers[0].ProviderID)
	assert.Equal(t, "Groq", config.Providers[0].DisplayLabel)
	assert.True(t, config.Providers[0].HasAPIKey)
	// custom provider は manual model 登録が前提なので、credential が揃っても
	// model 登録までは「configured = false」のままにする。
	assert.False(t, config.Providers[0].Configured)
	assert.Equal(t, "secret", secretStore.values[secretKey(credentialService, "llm.openai_compatible:groq.api_key")])

	// AddCustomModel すると configured = true になり、SetActiveModel もできる。
	added, err := manager.AddCustomModel(context.Background(), "openai_compatible:groq", "llama-3.3-70b-versatile")
	require.NoError(t, err)
	require.Len(t, added.Providers, 1)
	assert.Equal(t, []string{"llama-3.3-70b-versatile"}, added.Providers[0].Models)
	assert.True(t, added.Providers[0].Configured)

	_, err = manager.SetActiveModel(context.Background(), "openai_compatible:groq", "llama-3.3-70b-versatile")
	require.NoError(t, err)
	gateway, err := manager.Gateway(context.Background())
	require.NoError(t, err)
	_, ok := gateway.(*llm.OpenAICompatibleGateway)
	assert.True(t, ok)
}

func TestRemoveCustomModelClearsActiveWhenSame(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID:   "openai_compatible:local",
		DisplayLabel: "Local",
		Options: map[string]any{
			"base_url":         "http://localhost:8080/v1",
			"requires_api_key": false,
		},
	})
	require.NoError(t, err)
	_, err = manager.AddCustomModel(context.Background(), "openai_compatible:local", "model-x")
	require.NoError(t, err)
	_, err = manager.SetActiveModel(context.Background(), "openai_compatible:local", "model-x")
	require.NoError(t, err)

	config, err := manager.RemoveCustomModel(context.Background(), "openai_compatible:local", "model-x")
	require.NoError(t, err)
	assert.Empty(t, config.Providers[0].Models)
	assert.Nil(t, config.ActiveModel)
}

func TestOpenAICompatibleCanBeConfiguredWithoutAPIKey(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID:   "openai_compatible:local",
		DisplayLabel: "Local",
		Options: map[string]any{
			"base_url":         "http://localhost:8080/v1",
			"requires_api_key": false,
		},
	})
	require.NoError(t, err)
	_, err = manager.AddCustomModel(context.Background(), "openai_compatible:local", "local-model")
	require.NoError(t, err)
	config, err := manager.SetActiveModel(context.Background(), "openai_compatible:local", "local-model")
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.True(t, config.Providers[0].Configured)

	_, err = manager.Gateway(context.Background())
	require.NoError(t, err)
}

func TestProviderConnectionUsesSavedProviderWithMinimalOutput(t *testing.T) {
	var maxTokens float64
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload map[string]any
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		maxTokens, _ = payload["max_tokens"].(float64)
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)

	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID:   "openai_compatible:test",
		DisplayLabel: "Test endpoint",
		Options: map[string]any{
			"base_url":         server.URL,
			"requires_api_key": true,
		},
		APIKey: "sk-test",
	})
	require.NoError(t, err)
	_, err = manager.AddCustomModel(context.Background(), "openai_compatible:test", "test-model")
	require.NoError(t, err)

	result, err := manager.TestProviderConnection(context.Background(), "openai_compatible:test")
	require.NoError(t, err)
	assert.True(t, result.OK)
	assert.Empty(t, result.Error)
	assert.Equal(t, float64(1), maxTokens)
}

func TestProviderConnectionReturnsProviderError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(server.Close)

	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID:   "openai_compatible:test",
		DisplayLabel: "Test endpoint",
		Options: map[string]any{
			"base_url":         server.URL,
			"requires_api_key": true,
		},
		APIKey: "bad-key",
	})
	require.NoError(t, err)
	_, err = manager.AddCustomModel(context.Background(), "openai_compatible:test", "test-model")
	require.NoError(t, err)

	result, err := manager.TestProviderConnection(context.Background(), "openai_compatible:test")
	require.NoError(t, err)
	assert.False(t, result.OK)
	assert.Contains(t, result.Error, "Test endpointのAPI key")
}

func TestListProviderModelsUsesAPIAndCachesResult(t *testing.T) {
	requestCount := 0
	manager, settingStore, _ := newTestManager()
	manager.listModels = func(_ context.Context, cfg llm.ProviderConfig, _ llm.Deps) ([]llm.ModelDescriptor, error) {
		requestCount++
		assert.Equal(t, llm.ProviderOpenAI, cfg.ProviderID)
		return []llm.ModelDescriptor{
			{ID: "alpha-1", Source: llm.ModelSourceAPI},
			{ID: "alpha-2", Source: llm.ModelSourceAPI},
		}, nil
	}
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai",
		APIKey:     "sk",
	})
	require.NoError(t, err)

	listing, err := manager.ListProviderModels(context.Background(), "openai", true)
	require.NoError(t, err)
	assert.Equal(t, llm.ModelSourceAPI, listing.Source)
	ids := make([]string, 0, len(listing.Models))
	for _, model := range listing.Models {
		ids = append(ids, model.ID)
	}
	assert.Contains(t, ids, "alpha-1")
	assert.Contains(t, ids, "alpha-2")
	require.NotNil(t, listing.FetchedAt)

	// cache が SQLite に書かれていること。
	assert.Contains(t, settingStore.values[llmModelCachePrefix+"openai"], "alpha-1")
	assert.Equal(t, 1, requestCount)
}

// F14: composer popover が短時間に何度開閉されても、TTL 内なら ListProviderModels
// は cache を返して上流 listing API を二度叩かない。Refresh button (force=true)
// のときだけ upstream へ抜ける。
func TestListProviderModelsServesCacheWithinTTLAndForceBypassesIt(t *testing.T) {
	requestCount := 0
	manager, _, _ := newTestManager()
	manager.listModels = func(_ context.Context, _ llm.ProviderConfig, _ llm.Deps) ([]llm.ModelDescriptor, error) {
		requestCount++
		return []llm.ModelDescriptor{{ID: "alpha-1", Source: llm.ModelSourceAPI}}, nil
	}
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai",
		APIKey:     "sk",
	})
	require.NoError(t, err)

	// 初回 (force=false) は cache が無いので API hit する。以降 TTL 内は cache。
	first, err := manager.ListProviderModels(context.Background(), "openai", false)
	require.NoError(t, err)
	assert.Equal(t, llm.ModelSourceAPI, first.Source)
	require.Equal(t, 1, requestCount)

	for range 5 {
		next, err := manager.ListProviderModels(context.Background(), "openai", false)
		require.NoError(t, err)
		assert.Equal(t, llm.ModelSourceCache, next.Source)
	}
	assert.Equal(t, 1, requestCount, "popover の連続 lazy fetch は cache を返して上流を叩かない")

	// Refresh button (force=true) は cache を bypass して upstream を叩く。
	refreshed, err := manager.ListProviderModels(context.Background(), "openai", true)
	require.NoError(t, err)
	assert.Equal(t, llm.ModelSourceAPI, refreshed.Source)
	assert.Equal(t, 2, requestCount)
}

func TestListProviderModelsFallsBackToCacheWhenAPIFails(t *testing.T) {
	manager, settingStore, _ := newTestManager()
	manager.listModels = func(context.Context, llm.ProviderConfig, llm.Deps) ([]llm.ModelDescriptor, error) {
		return nil, errors.New("listing unavailable")
	}
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai",
		APIKey:     "sk",
	})
	require.NoError(t, err)

	cacheEntry := storedModelCache{
		Models:    []llm.ModelDescriptor{{ID: "cached-alpha", Source: llm.ModelSourceAPI}},
		FetchedAt: time.Now().Add(-2 * time.Hour),
	}
	encoded, _ := json.Marshal(cacheEntry)
	settingStore.values[llmModelCachePrefix+"openai"] = string(encoded)

	// force=true so we exercise the api → cache fallback rather than the
	// TTL-fresh cache short-circuit.
	listing, err := manager.ListProviderModels(context.Background(), "openai", true)
	require.NoError(t, err)
	assert.Equal(t, llm.ModelSourceCache, listing.Source)
	require.NotEmpty(t, listing.Models)
	assert.Equal(t, "cached-alpha", listing.Models[0].ID)
	assert.NotEmpty(t, listing.Error, "API failure must be surfaced even when cache is used")
}

func TestListProviderModelsFallsBackToBuiltinWhenAPIAndCacheFail(t *testing.T) {
	manager, _, _ := newTestManager()
	manager.listModels = func(context.Context, llm.ProviderConfig, llm.Deps) ([]llm.ModelDescriptor, error) {
		return nil, errors.New("listing unavailable")
	}
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "anthropic",
		APIKey:     "sk",
	})
	require.NoError(t, err)

	listing, err := manager.ListProviderModels(context.Background(), "anthropic", true)
	require.NoError(t, err)
	assert.Equal(t, llm.ModelSourceBuiltin, listing.Source)
	assert.NotEmpty(t, listing.Models, "builtin seed list must always be available")
}

func TestListProviderModelsUsesBuiltinForGoogle(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "google",
		APIKey:     "sk",
	})
	require.NoError(t, err)

	listing, err := manager.ListProviderModels(context.Background(), "google", false)
	require.NoError(t, err)
	assert.Equal(t, llm.ModelSourceBuiltin, listing.Source)
	assert.NotEmpty(t, listing.Models)
}

func TestListProviderModelsReturnsManualEntriesForOpenAICompatible(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID:   "openai_compatible:foo",
		DisplayLabel: "Foo",
		Options:      map[string]any{"base_url": "http://localhost:1234/v1"},
		APIKey:       "secret",
	})
	require.NoError(t, err)
	_, err = manager.AddCustomModel(context.Background(), "openai_compatible:foo", "custom-1")
	require.NoError(t, err)

	listing, err := manager.ListProviderModels(context.Background(), "openai_compatible:foo", false)
	require.NoError(t, err)
	require.Len(t, listing.Models, 1)
	assert.Equal(t, "custom-1", listing.Models[0].ID)
}

func TestSetActiveProviderUsesLastUsedModel(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", APIKey: "k",
	})
	require.NoError(t, err)
	_, err = manager.SetActiveModel(context.Background(), "openrouter", "openai/gpt-5")
	require.NoError(t, err)

	// Switch away, then back: provider returns to its last model.
	_, err = manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai", APIKey: "k",
	})
	require.NoError(t, err)
	_, err = manager.SetActiveModel(context.Background(), "openai", "gpt-5")
	require.NoError(t, err)

	config, err := manager.SetActiveProvider(context.Background(), "openrouter")
	require.NoError(t, err)
	require.NotNil(t, config.ActiveModel)
	assert.Equal(t, "openrouter", config.ActiveModel.ProviderID)
	assert.Equal(t, "openai/gpt-5", config.ActiveModel.ModelID)
}

func TestResolveModelDescriptorPrefersCacheThenBuiltin(t *testing.T) {
	// F11: gatewayForModel が context budget を計算するために、cache → builtin の
	// 順で ModelDescriptor を解決する。listing API は呼ばない（fast path）。
	manager, settingStore, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "anthropic", APIKey: "sk",
	})
	require.NoError(t, err)

	// cache 経由: 直接 settings store に書き込んだ cache が優先される。
	cacheEntry := storedModelCache{
		Models: []llm.ModelDescriptor{{
			ID:              "claude-sonnet-4-6",
			DisplayName:     "Cached Sonnet",
			ContextWindow:   123_456,
			MaxOutputTokens: 32_000,
			Source:          llm.ModelSourceAPI,
		}},
		FetchedAt: time.Now(),
	}
	encoded, _ := json.Marshal(cacheEntry)
	settingStore.values[llmModelCachePrefix+"anthropic"] = string(encoded)

	descriptor := manager.resolveModelDescriptor(context.Background(), "anthropic", "claude-sonnet-4-6")
	assert.Equal(t, 123_456, descriptor.ContextWindow)
	assert.Equal(t, "Cached Sonnet", descriptor.DisplayName)

	// builtin fallback: cache に無い model id は BuiltinModels から拾われる。
	descriptor = manager.resolveModelDescriptor(context.Background(), "anthropic", "claude-haiku-4-5-20251001")
	assert.Equal(t, 200_000, descriptor.ContextWindow)

	// 完全に未知: 空 descriptor が返り、後段の EstimateBudget が fallback に落ちる。
	descriptor = manager.resolveModelDescriptor(context.Background(), "anthropic", "totally-unknown-id")
	assert.Equal(t, 0, descriptor.ContextWindow)
	assert.Equal(t, "totally-unknown-id", descriptor.ID)
}

type failingSecretStore struct{}

func (failingSecretStore) Get(string, string) (string, error) { return "", errors.New("locked") }
func (failingSecretStore) Set(string, string, string) error   { return errors.New("locked") }
func (failingSecretStore) Delete(string, string) error        { return errors.New("locked") }

func TestEnvVarNameFor(t *testing.T) {
	assert.Equal(t, "GLINT_OPENROUTER_API_KEY", envVarNameFor("openrouter"))
	assert.Equal(t, "GLINT_OPENAI_API_KEY", envVarNameFor("openai"))
	assert.Equal(t, "GLINT_ANTHROPIC_API_KEY", envVarNameFor("anthropic"))
	assert.Equal(t, "GLINT_GOOGLE_API_KEY", envVarNameFor("google"))
	assert.Equal(t, "GLINT_OLLAMA_API_KEY", envVarNameFor("ollama"))
	// openai_compatible:<slug> normalizes the slug to uppercase + underscores.
	assert.Equal(t, "GLINT_OPENAI_COMPATIBLE_GROQ_API_KEY", envVarNameFor("openai_compatible:groq"))
	assert.Equal(t, "GLINT_OPENAI_COMPATIBLE_MY_TENANT_API_KEY", envVarNameFor("openai_compatible:my-tenant"))
	// Template id without a slug must not produce a usable env var name.
	assert.Equal(t, "", envVarNameFor("openai_compatible"))
	assert.Equal(t, "", envVarNameFor(""))
}

func TestResolveAPIKeyPrefersEnvOverKeyring(t *testing.T) {
	manager, _, secretStore := newTestManager()
	secretStore.values[secretKey(credentialService, apiKeyAccount("openai"))] = "keyring-value"
	manager.lookupEnv = func(name string) (string, bool) {
		if name == "GLINT_OPENAI_API_KEY" {
			return "env-value", true
		}
		return "", false
	}

	value, source, err := manager.resolveAPIKey("openai")
	require.NoError(t, err)
	assert.Equal(t, "env-value", value)
	assert.Equal(t, CredentialSourceEnv, source)
}

func TestResolveAPIKeyFallsBackToKeyringWhenEnvUnset(t *testing.T) {
	manager, _, secretStore := newTestManager()
	secretStore.values[secretKey(credentialService, apiKeyAccount("openai"))] = "keyring-value"
	manager.lookupEnv = func(string) (string, bool) { return "", false }

	value, source, err := manager.resolveAPIKey("openai")
	require.NoError(t, err)
	assert.Equal(t, "keyring-value", value)
	assert.Equal(t, CredentialSourceKeyring, source)
}

func TestResolveAPIKeyIgnoresBlankEnvValues(t *testing.T) {
	// A blank env var must not silently win over a real keyring entry.
	manager, _, secretStore := newTestManager()
	secretStore.values[secretKey(credentialService, apiKeyAccount("openai"))] = "keyring-value"
	manager.lookupEnv = func(name string) (string, bool) {
		if name == "GLINT_OPENAI_API_KEY" {
			return "   ", true
		}
		return "", false
	}

	value, source, err := manager.resolveAPIKey("openai")
	require.NoError(t, err)
	assert.Equal(t, "keyring-value", value)
	assert.Equal(t, CredentialSourceKeyring, source)
}

func TestResolveAPIKeyReturnsNoneWhenNothingAvailable(t *testing.T) {
	manager, _, _ := newTestManager()
	manager.lookupEnv = func(string) (string, bool) { return "", false }

	value, source, err := manager.resolveAPIKey("openai")
	require.NoError(t, err)
	assert.Equal(t, "", value)
	assert.Equal(t, CredentialSourceNone, source)
}

func TestGatewayPrefersEnvKeyOverKeyring(t *testing.T) {
	var seenAuth string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		seenAuth = request.Header.Get("Authorization")
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)

	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID:   "openai_compatible:test",
		DisplayLabel: "Test endpoint",
		Options: map[string]any{
			"base_url":         server.URL,
			"requires_api_key": true,
		},
		APIKey: "keyring-value",
	})
	require.NoError(t, err)
	_, err = manager.AddCustomModel(context.Background(), "openai_compatible:test", "test-model")
	require.NoError(t, err)

	manager.lookupEnv = func(name string) (string, bool) {
		if name == "GLINT_OPENAI_COMPATIBLE_TEST_API_KEY" {
			return "env-value", true
		}
		return "", false
	}

	// TestProviderConnection drives Gateway -> chat request through openai
	// adapter, so the wire-level Authorization header reflects whichever key
	// the manager handed to the gateway.
	result, err := manager.TestProviderConnection(context.Background(), "openai_compatible:test")
	require.NoError(t, err)
	assert.True(t, result.OK, "expected env key to satisfy the upstream: %s", result.Error)
	assert.Equal(t, "Bearer env-value", seenAuth)
}

func TestProviderSettingsSurfacesCredentialSource(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai", APIKey: "keyring",
	})
	require.NoError(t, err)

	// Without an env var the source is keyring.
	manager.lookupEnv = func(string) (string, bool) { return "", false }
	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.Equal(t, CredentialSourceKeyring, config.Providers[0].CredentialSource)
	assert.True(t, config.Providers[0].HasAPIKey)

	// With an env var override the source switches to env, and the API key
	// itself is never returned over the Wails boundary (only the source flag).
	manager.lookupEnv = func(name string) (string, bool) {
		if name == "GLINT_OPENAI_API_KEY" {
			return "env-only-secret", true
		}
		return "", false
	}
	config, err = manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	encoded, err := json.Marshal(config)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "env-only-secret", "secret must never appear in wire payload")
	require.Len(t, config.Providers, 1)
	assert.Equal(t, CredentialSourceEnv, config.Providers[0].CredentialSource)
	assert.True(t, config.Providers[0].HasAPIKey)
	assert.True(t, config.Providers[0].Configured)
}

func TestEnvVarMakesUnconfiguredProviderConfigured(t *testing.T) {
	// A provider with no keyring entry still becomes configured when the env
	// var supplies the credential. This is the dev / CI scenario the design
	// optimizes for.
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai",
	})
	require.NoError(t, err)

	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.False(t, config.Providers[0].Configured)

	manager.lookupEnv = func(name string) (string, bool) {
		if name == "GLINT_OPENAI_API_KEY" {
			return "env-value", true
		}
		return "", false
	}
	config, err = manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.True(t, config.Providers[0].Configured)
	assert.True(t, config.Providers[0].HasAPIKey)
	assert.Equal(t, CredentialSourceEnv, config.Providers[0].CredentialSource)
}

func TestEnvVarForOpenAICompatibleUsesSlugNamespace(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID:   "openai_compatible:my-tenant",
		DisplayLabel: "Tenant",
		Options: map[string]any{
			"base_url":         "http://localhost:1234/v1",
			"requires_api_key": true,
		},
	})
	require.NoError(t, err)

	manager.lookupEnv = func(name string) (string, bool) {
		if name == "GLINT_OPENAI_COMPATIBLE_MY_TENANT_API_KEY" {
			return "env-value", true
		}
		return "", false
	}
	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.Equal(t, CredentialSourceEnv, config.Providers[0].CredentialSource)
	assert.True(t, config.Providers[0].HasAPIKey)
}
