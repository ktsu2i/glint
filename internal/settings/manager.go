package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/kaito/glint/internal/llm"
	keyring "github.com/zalando/go-keyring"
)

const (
	llmSettingKey      = "llm.openrouter"
	credentialService  = "com.glint.desktop"
	openRouterKeyEntry = "openrouter-api-key"
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

type LLMSettings struct {
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	ZDR        bool   `json:"zdr"`
	HasAPIKey  bool   `json:"hasApiKey"`
	Configured bool   `json:"configured"`
}

type SaveLLMSettingsRequest struct {
	Model       string `json:"model"`
	APIKey      string `json:"apiKey"`
	ZDR         bool   `json:"zdr"`
	ClearAPIKey bool   `json:"clearApiKey"`
}

type storedLLMSettings struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	ZDR      bool   `json:"zdr"`
}

type Manager struct {
	store   SettingStore
	secrets SecretStore
}

func NewManager(store SettingStore, secrets SecretStore) *Manager {
	return &Manager{store: store, secrets: secrets}
}

func (manager *Manager) Get(ctx context.Context) (LLMSettings, error) {
	stored, err := manager.load(ctx)
	if err != nil {
		return LLMSettings{}, err
	}
	_, secretErr := manager.secrets.Get(credentialService, openRouterKeyEntry)
	hasAPIKey := secretErr == nil
	if secretErr != nil && !errors.Is(secretErr, ErrSecretNotFound) {
		return LLMSettings{}, fmt.Errorf("read OpenRouter API key from credential store: %w", secretErr)
	}
	return publicSettings(stored, hasAPIKey), nil
}

func (manager *Manager) Save(ctx context.Context, request SaveLLMSettingsRequest) (LLMSettings, error) {
	request.Model = strings.TrimSpace(request.Model)
	request.APIKey = strings.TrimSpace(request.APIKey)
	if request.Model == "" {
		return LLMSettings{}, errors.New("OpenRouter modelを入力してください。")
	}
	if !strings.Contains(request.Model, "/") {
		return LLMSettings{}, errors.New("modelは provider/model 形式で入力してください。")
	}
	if request.ClearAPIKey && request.APIKey != "" {
		return LLMSettings{}, errors.New("API keyの更新と削除は同時に指定できません。")
	}

	if request.ClearAPIKey {
		if err := manager.secrets.Delete(credentialService, openRouterKeyEntry); err != nil {
			return LLMSettings{}, fmt.Errorf("delete OpenRouter API key from credential store: %w", err)
		}
	} else if request.APIKey != "" {
		if err := manager.secrets.Set(credentialService, openRouterKeyEntry, request.APIKey); err != nil {
			return LLMSettings{}, fmt.Errorf("save OpenRouter API key to credential store: %w", err)
		}
	}

	stored := storedLLMSettings{Provider: "openrouter", Model: request.Model, ZDR: request.ZDR}
	data, err := json.Marshal(stored)
	if err != nil {
		return LLMSettings{}, fmt.Errorf("encode LLM settings: %w", err)
	}
	if err := manager.store.SaveSetting(ctx, llmSettingKey, string(data)); err != nil {
		return LLMSettings{}, err
	}
	return manager.Get(ctx)
}

// Gateway resolves the latest configuration for every request. This allows a
// settings change to take effect without restarting the desktop app.
func (manager *Manager) Gateway(ctx context.Context) (llm.Gateway, error) {
	stored, err := manager.load(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(stored.Model) == "" {
		return nil, errors.New("OpenRouterのmodelを設定してください。")
	}
	apiKey, err := manager.secrets.Get(credentialService, openRouterKeyEntry)
	if errors.Is(err, ErrSecretNotFound) {
		return nil, errors.New("OpenRouter API keyを設定してください。")
	}
	if err != nil {
		return nil, fmt.Errorf("read OpenRouter API key from credential store: %w", err)
	}
	return llm.NewOpenRouterGateway(llm.OpenRouterConfig{
		APIKey: apiKey,
		Model:  stored.Model,
		ZDR:    stored.ZDR,
	})
}

func (manager *Manager) load(ctx context.Context) (storedLLMSettings, error) {
	value, err := manager.store.Setting(ctx, llmSettingKey)
	if err != nil {
		return storedLLMSettings{}, err
	}
	if value == "" {
		return storedLLMSettings{Provider: "openrouter", ZDR: true}, nil
	}
	var stored storedLLMSettings
	if err := json.Unmarshal([]byte(value), &stored); err != nil {
		return storedLLMSettings{}, fmt.Errorf("decode LLM settings: %w", err)
	}
	if stored.Provider == "" {
		stored.Provider = "openrouter"
	}
	return stored, nil
}

func publicSettings(stored storedLLMSettings, hasAPIKey bool) LLMSettings {
	return LLMSettings{
		Provider:   stored.Provider,
		Model:      stored.Model,
		ZDR:        stored.ZDR,
		HasAPIKey:  hasAPIKey,
		Configured: stored.Model != "" && hasAPIKey,
	}
}
