package settings

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

const languageSettingKey = "application.language"

// ErrInvalidLanguage reports a language other than en or ja.
var ErrInvalidLanguage = errors.New("language must be en or ja")

type Language string

const (
	LanguageEnglish  Language = "en"
	LanguageJapanese Language = "ja"
)

type LanguageSettings struct {
	Language Language `json:"language"`
}

type SaveLanguageSettingsRequest struct {
	Language Language `json:"language"`
}

func (manager *Manager) GetLanguage(ctx context.Context) (LanguageSettings, error) {
	value, err := manager.store.Setting(ctx, languageSettingKey)
	if err != nil {
		return LanguageSettings{}, err
	}
	if strings.TrimSpace(value) == "" {
		return LanguageSettings{Language: LanguageEnglish}, nil
	}
	language := Language(value)
	if !language.Valid() {
		return LanguageSettings{}, fmt.Errorf("invalid saved language %q", value)
	}
	return LanguageSettings{Language: language}, nil
}

func (manager *Manager) SaveLanguage(ctx context.Context, request SaveLanguageSettingsRequest) (LanguageSettings, error) {
	if !request.Language.Valid() {
		return LanguageSettings{}, ErrInvalidLanguage
	}
	if err := manager.store.SaveSetting(ctx, languageSettingKey, string(request.Language)); err != nil {
		return LanguageSettings{}, err
	}
	return LanguageSettings{Language: request.Language}, nil
}

func (language Language) Valid() bool {
	return language == LanguageEnglish || language == LanguageJapanese
}
