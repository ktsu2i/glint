package settings

import (
	"context"
	"testing"
)

func TestLanguageDefaultsToEnglish(t *testing.T) {
	manager, _ := newTestManager()

	settings, err := manager.GetLanguage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if settings.Language != LanguageEnglish {
		t.Fatalf("expected english default, got %q", settings.Language)
	}
}

func TestLanguagePersistsSupportedPreference(t *testing.T) {
	manager, store := newTestManager()

	saved, err := manager.SaveLanguage(context.Background(), SaveLanguageSettingsRequest{Language: LanguageJapanese})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Language != LanguageJapanese || store.values[languageSettingKey] != "ja" {
		t.Fatalf("language was not persisted: %#v", saved)
	}
	loaded, err := manager.GetLanguage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Language != LanguageJapanese {
		t.Fatalf("expected persisted language, got %q", loaded.Language)
	}

	if _, err = manager.SaveLanguage(context.Background(), SaveLanguageSettingsRequest{Language: "fr"}); err == nil {
		t.Fatal("expected unsupported language to fail")
	}
}
