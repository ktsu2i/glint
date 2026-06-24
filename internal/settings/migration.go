package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type legacyOpenRouterSettings struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	ZDR      bool   `json:"zdr"`
}

// ensureMigration moves any pre-F2 OpenRouter-only config into the new
// multi-provider schema. It runs lazily on the first read after upgrade and
// short-circuits via llm.migration_v2_done thereafter.
func (manager *Manager) ensureMigration(ctx context.Context) error {
	if manager.migrated {
		return nil
	}
	done, err := manager.store.Setting(ctx, llmMigrationDoneKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(done) == "1" {
		manager.migrated = true
		return nil
	}

	if err := manager.migrateLegacyOpenRouter(ctx); err != nil {
		return err
	}
	if err := manager.store.SaveSetting(ctx, llmMigrationDoneKey, "1"); err != nil {
		return err
	}
	manager.migrated = true
	return nil
}

func (manager *Manager) migrateLegacyOpenRouter(ctx context.Context) error {
	legacy, err := manager.store.Setting(ctx, legacyLLMSettingKey)
	if err != nil {
		return err
	}
	hasLegacySettings := strings.TrimSpace(legacy) != ""
	var parsed legacyOpenRouterSettings
	if hasLegacySettings {
		if err := json.Unmarshal([]byte(legacy), &parsed); err != nil {
			return fmt.Errorf("decode legacy LLM settings: %w", err)
		}
	}

	existing, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return err
	}
	if hasLegacySettings {
		if _, alreadyPresent := existing["openrouter"]; !alreadyPresent {
			existing["openrouter"] = storedProvider{
				Model:   strings.TrimSpace(parsed.Model),
				Options: map[string]any{"zdr": parsed.ZDR},
			}
			if err := manager.saveStoredProviders(ctx, existing); err != nil {
				return err
			}
		}
		active, err := manager.loadActiveProviderID(ctx)
		if err != nil {
			return err
		}
		if active == "" {
			if err := manager.store.SaveSetting(ctx, llmActiveProviderKey, "openrouter"); err != nil {
				return err
			}
		}
	}

	apiKey, err := manager.secrets.Get(credentialService, legacyOpenRouterKeyEntry)
	switch {
	case err == nil:
		newAccount := apiKeyAccount("openrouter")
		if _, getErr := manager.secrets.Get(credentialService, newAccount); errors.Is(getErr, ErrSecretNotFound) {
			if setErr := manager.secrets.Set(credentialService, newAccount, apiKey); setErr != nil {
				return fmt.Errorf("copy legacy OpenRouter key to new entry: %w", setErr)
			}
		} else if getErr != nil && !errors.Is(getErr, ErrSecretNotFound) {
			return fmt.Errorf("read new OpenRouter API key entry: %w", getErr)
		}
	case errors.Is(err, ErrSecretNotFound):
		// nothing to migrate
	default:
		return fmt.Errorf("read legacy OpenRouter API key: %w", err)
	}
	return nil
}
