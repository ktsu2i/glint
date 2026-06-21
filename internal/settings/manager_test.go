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

func TestManagerDefaultsToOpenRouterWithZDR(t *testing.T) {
	manager, _, _ := newTestManager()
	settings, err := manager.Get(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "openrouter", settings.Provider)
	assert.True(t, settings.ZDR)
	assert.False(t, settings.HasAPIKey)
	assert.False(t, settings.Configured)
}

func TestManagerSeparatesAPIKeyFromPersistedSettings(t *testing.T) {
	manager, settingStore, secretStore := newTestManager()
	saved, err := manager.Save(context.Background(), SaveLLMSettingsRequest{
		Model: " provider/model ", APIKey: " secret-value ", ZDR: true,
	})
	require.NoError(t, err)
	assert.True(t, saved.Configured)
	assert.Equal(t, "provider/model", saved.Model)
	assert.NotContains(t, settingStore.values[llmSettingKey], "secret-value")
	assert.Equal(t, "secret-value", secretStore.values[secretKey(credentialService, openRouterKeyEntry)])

	_, err = manager.Gateway(context.Background())
	require.NoError(t, err)
}

func TestManagerPreservesAndClearsAPIKey(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.Save(context.Background(), SaveLLMSettingsRequest{
		Model: "provider/first", APIKey: "secret", ZDR: true,
	})
	require.NoError(t, err)
	updated, err := manager.Save(context.Background(), SaveLLMSettingsRequest{
		Model: "provider/second", ZDR: false,
	})
	require.NoError(t, err)
	assert.True(t, updated.HasAPIKey)

	cleared, err := manager.Save(context.Background(), SaveLLMSettingsRequest{
		Model: "provider/second", ClearAPIKey: true,
	})
	require.NoError(t, err)
	assert.False(t, cleared.Configured)
	_, err = manager.Gateway(context.Background())
	assert.ErrorContains(t, err, "API key")
}

func TestManagerValidatesSettings(t *testing.T) {
	manager, _, _ := newTestManager()
	_, err := manager.Save(context.Background(), SaveLLMSettingsRequest{})
	assert.Error(t, err)
	_, err = manager.Save(context.Background(), SaveLLMSettingsRequest{Model: "invalid"})
	assert.Error(t, err)
	_, err = manager.Save(context.Background(), SaveLLMSettingsRequest{
		Model: "provider/model", APIKey: "new", ClearAPIKey: true,
	})
	assert.Error(t, err)
}

func TestManagerSurfacesCredentialFailures(t *testing.T) {
	manager, _, _ := newTestManager()
	manager.secrets = failingSecretStore{}
	_, err := manager.Get(context.Background())
	assert.Error(t, err)
}

type failingSecretStore struct{}

func (failingSecretStore) Get(string, string) (string, error) { return "", errors.New("locked") }
func (failingSecretStore) Set(string, string, string) error   { return errors.New("locked") }
func (failingSecretStore) Delete(string, string) error        { return errors.New("locked") }
