package settings

import (
	"context"
	"errors"
	"testing"

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
	assert.Equal(t, "openrouter", string(config.Catalog[0].ID))
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

type failingSecretStore struct{}

func (failingSecretStore) Get(string, string) (string, error) { return "", errors.New("locked") }
func (failingSecretStore) Set(string, string, string) error   { return errors.New("locked") }
func (failingSecretStore) Delete(string, string) error        { return errors.New("locked") }
