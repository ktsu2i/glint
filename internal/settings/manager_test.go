package settings

import (
	"context"
	"errors"
	"testing"

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
		Model:      " provider/model ",
		Options:    map[string]any{"zdr": true},
		APIKey:     " secret-value ",
	})
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	provider := config.Providers[0]
	assert.Equal(t, "provider/model", provider.Model)
	assert.True(t, provider.Configured)
	assert.True(t, provider.HasAPIKey)
	assert.True(t, provider.IsActive)
	assert.Equal(t, "openrouter", config.ActiveProviderID)

	assert.NotContains(t, settingStore.values[llmProvidersKey], "secret-value")
	assert.Equal(t, "secret-value", secretStore.values[openRouterAccount()])

	_, err = manager.Gateway(context.Background())
	require.NoError(t, err)
}

func TestUpsertWithoutAPIKeyKeepsExistingCredential(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", Model: "provider/first", Options: map[string]any{"zdr": true}, APIKey: "secret",
	})
	require.NoError(t, err)

	config, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", Model: "provider/second", Options: map[string]any{"zdr": false},
	})
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.True(t, config.Providers[0].HasAPIKey)
	assert.Equal(t, "provider/second", config.Providers[0].Model)
	assert.Equal(t, false, config.Providers[0].Options["zdr"])
}

func TestUpsertClearAPIKeyRemovesCredentialButKeepsConfig(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", Model: "provider/first", APIKey: "secret",
	})
	require.NoError(t, err)

	config, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", Model: "provider/first", ClearAPIKey: true,
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
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{ProviderID: "openrouter"})
	assert.ErrorContains(t, err, "model")

	_, err = manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{ProviderID: "openrouter", Model: "invalid"})
	assert.ErrorContains(t, err, "provider/model")

	_, err = manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", Model: "provider/model", APIKey: "new", ClearAPIKey: true,
	})
	assert.ErrorContains(t, err, "同時")

	_, err = manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{ProviderID: "no-such-provider", Model: "provider/x"})
	assert.ErrorContains(t, err, "未知")
}

func TestDeleteProviderRemovesConfigAndCredential(t *testing.T) {
	manager, _, secretStore := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", Model: "provider/model", APIKey: "secret",
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
		ProviderID: "openrouter", Model: "provider/model", APIKey: "secret",
	})
	require.NoError(t, err)

	_, err = manager.SetActiveProvider(context.Background(), "unknown")
	assert.Error(t, err)

	cleared, err := manager.SetActiveProvider(context.Background(), "")
	require.NoError(t, err)
	assert.Equal(t, "", cleared.ActiveProviderID)
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
	assert.Equal(t, "legacy-key", secretStore.values[openRouterAccount()])
	assert.Equal(t, "legacy-key", secretStore.values[secretKey(credentialService, legacyOpenRouterKeyEntry)], "legacy key should remain for fallback")
	assert.Equal(t, "1", settingStore.values[llmMigrationDoneKey])
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

func TestManagerSurfacesCredentialFailures(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openrouter", Model: "provider/model", APIKey: "secret",
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
		Model:      "llama3",
		Options:    map[string]any{"base_url": "http://localhost:11434/v1"},
	})
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.Equal(t, "ollama", config.Providers[0].ProviderID)
	assert.False(t, config.Providers[0].HasAPIKey)
	assert.True(t, config.Providers[0].Configured)
	assert.True(t, config.Providers[0].IsActive)

	gateway, err := manager.Gateway(context.Background())
	require.NoError(t, err)
	_, ok := gateway.(*llm.OllamaGateway)
	assert.True(t, ok)
}

func TestUpsertOpenAIPersistsOrganization(t *testing.T) {
	manager, settingStore, secretStore := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai",
		Model:      "gpt-5",
		Options:    map[string]any{"organization": "org_abc"},
		APIKey:     "sk-secret",
	})
	require.NoError(t, err)

	config, err := manager.GetLLMConfig(context.Background())
	require.NoError(t, err)
	require.Len(t, config.Providers, 1)
	assert.Equal(t, "openai", config.Providers[0].ProviderID)
	assert.Equal(t, "org_abc", config.Providers[0].Options["organization"])
	assert.True(t, config.Providers[0].HasAPIKey)
	assert.NotContains(t, settingStore.values[llmProvidersKey], "sk-secret")
	assert.Equal(t, "sk-secret", secretStore.values[secretKey(credentialService, "llm.openai.api_key")])
}

func TestUpsertOpenAICompatibleRequiresSlug(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.UpsertProviderSettings(context.Background(), UpsertProviderRequest{
		ProviderID: "openai_compatible",
		Model:      "llama-3.3-70b",
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
		Model:        "llama-3.3-70b-versatile",
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
	assert.Equal(t, "secret", secretStore.values[secretKey(credentialService, "llm.openai_compatible:groq.api_key")])

	gateway, err := manager.Gateway(context.Background())
	require.NoError(t, err)
	_, ok := gateway.(*llm.OpenAICompatibleGateway)
	assert.True(t, ok)
}

type failingSecretStore struct{}

func (failingSecretStore) Get(string, string) (string, error) { return "", errors.New("locked") }
func (failingSecretStore) Set(string, string, string) error   { return errors.New("locked") }
func (failingSecretStore) Delete(string, string) error        { return errors.New("locked") }
