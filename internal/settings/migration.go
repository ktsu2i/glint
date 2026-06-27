package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

type legacyOpenRouterSettings struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	ZDR      bool   `json:"zdr"`
}

// ensureMigration moves pre-F2 OpenRouter config into the multi-provider
// schema, then removes the legacy keyring entry after the replacement exists.
// Both steps are idempotent and have independent completion markers.
func (manager *Manager) ensureMigration(ctx context.Context) error {
	if manager.migrated {
		return nil
	}
	done, err := manager.store.Setting(ctx, llmMigrationDoneKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(done) != "1" {
		if err := manager.migrateLegacyOpenRouter(ctx); err != nil {
			return err
		}
		if err := manager.store.SaveSetting(ctx, llmMigrationDoneKey, "1"); err != nil {
			return err
		}
	}

	cleanupDone, err := manager.store.Setting(ctx, llmKeyCleanupDoneKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(cleanupDone) != "1" {
		if err := manager.cleanupLegacyOpenRouterKey(); err != nil {
			return err
		}
		if err := manager.store.SaveSetting(ctx, llmKeyCleanupDoneKey, "1"); err != nil {
			return err
		}
	}

	// F10: model 単独保存と active_provider を models[] + active_model_ref に
	// 持ち上げる。`llm.providers.<id>.model` から `models[]` に1件コピーし、
	// 同時に `llm.active_provider` を `llm.active_model_ref` に変換する。
	modelsDone, err := manager.store.Setting(ctx, llmModelsMigrationKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(modelsDone) != "1" {
		if err := manager.migrateToActiveModelRef(ctx); err != nil {
			return err
		}
		if err := manager.store.SaveSetting(ctx, llmModelsMigrationKey, "1"); err != nil {
			return err
		}
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

func (manager *Manager) cleanupLegacyOpenRouterKey() error {
	legacyKey, err := manager.secrets.Get(credentialService, legacyOpenRouterKeyEntry)
	if errors.Is(err, ErrSecretNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read legacy OpenRouter API key: %w", err)
	}

	newAccount := apiKeyAccount("openrouter")
	_, err = manager.secrets.Get(credentialService, newAccount)
	switch {
	case err == nil:
	case errors.Is(err, ErrSecretNotFound):
		if err := manager.secrets.Set(credentialService, newAccount, legacyKey); err != nil {
			return fmt.Errorf("copy legacy OpenRouter key before cleanup: %w", err)
		}
	default:
		return fmt.Errorf("read new OpenRouter API key entry before cleanup: %w", err)
	}

	if err := manager.secrets.Delete(credentialService, legacyOpenRouterKeyEntry); err != nil {
		return fmt.Errorf("delete legacy OpenRouter API key: %w", err)
	}
	return nil
}

// migrateToActiveModelRef converts the F2 schema into the F10 one. Concretely:
//   - llm.providers.<id>.model (single value) becomes the first entry of
//     models[] and stays in `model` as the per-provider last-used pointer
//   - llm.active_provider is paired with that model to populate
//     llm.active_model_ref
//
// The migration is one-shot, idempotent (controlled by llm.migration_v4_done),
// and leaves the v2 keys intact so a downgrade-and-reupgrade still works.
func (manager *Manager) migrateToActiveModelRef(ctx context.Context) error {
	stored, err := manager.loadStoredProviders(ctx)
	if err != nil {
		return err
	}
	mutated := false
	for id, entry := range stored {
		trimmedModel := strings.TrimSpace(entry.Model)
		if trimmedModel == "" {
			continue
		}
		// Already part of models[]? skip.
		if !slices.Contains(entry.Models, trimmedModel) {
			entry.Models = append([]string{trimmedModel}, entry.Models...)
			stored[id] = entry
			mutated = true
		}
	}
	if mutated {
		if err := manager.saveStoredProviders(ctx, stored); err != nil {
			return err
		}
	}

	// active_model_ref が既に書かれているなら何もしない。
	existing, err := manager.store.Setting(ctx, llmActiveModelKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(existing) != "" {
		return nil
	}
	active, err := manager.loadActiveProviderID(ctx)
	if err != nil {
		return err
	}
	if active == "" {
		return nil
	}
	entry, exists := stored[active]
	if !exists {
		return nil
	}
	model := strings.TrimSpace(entry.Model)
	if model == "" {
		return nil
	}
	ref := ActiveModelRef{ProviderID: active, ModelID: model}
	encoded, err := json.Marshal(ref)
	if err != nil {
		return fmt.Errorf("encode active model ref during migration: %w", err)
	}
	return manager.store.SaveSetting(ctx, llmActiveModelKey, string(encoded))
}
