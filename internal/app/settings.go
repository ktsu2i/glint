package app

import (
	"errors"

	"github.com/kaito/glint/internal/settings"
)

type AppearanceSettings struct {
	Theme string `json:"theme"`
}

type SaveAppearanceSettingsRequest struct {
	Theme string `json:"theme"`
}

type LanguageSettings struct {
	Language string `json:"language"`
}

type SaveLanguageSettingsRequest struct {
	Language string `json:"language"`
}

// SettingsService is bound to the frontend for the appearance and language settings.
type SettingsService struct {
	base
	settings *settings.Manager
	text     localizer
}

func NewSettingsService(manager *settings.Manager) *SettingsService {
	return &SettingsService{settings: manager, text: localizer{settings: manager}}
}

func (s *SettingsService) GetAppearanceSettings() (AppearanceSettings, error) {
	if !s.ready() {
		return AppearanceSettings{}, errNotReady
	}
	saved, err := s.settings.GetAppearance(s.ctx)
	if err != nil {
		return AppearanceSettings{}, err
	}
	return AppearanceSettings{Theme: string(saved.Theme)}, nil
}

func (s *SettingsService) SaveAppearanceSettings(request SaveAppearanceSettingsRequest) (AppearanceSettings, error) {
	if !s.ready() {
		return AppearanceSettings{}, errNotReady
	}
	saved, err := s.settings.SaveAppearance(s.ctx, settings.SaveAppearanceSettingsRequest{
		Theme: settings.Theme(request.Theme),
	})
	if errors.Is(err, settings.ErrInvalidTheme) {
		return AppearanceSettings{}, s.text.error(s.ctx,
			"Theme must be light, dark, or system.",
			"テーマは light、dark、system のいずれかを指定してください。",
		)
	}
	if err != nil {
		return AppearanceSettings{}, err
	}
	return AppearanceSettings{Theme: string(saved.Theme)}, nil
}

func (s *SettingsService) GetLanguageSettings() (LanguageSettings, error) {
	if !s.ready() {
		return LanguageSettings{}, errNotReady
	}
	saved, err := s.settings.GetLanguage(s.ctx)
	if err != nil {
		return LanguageSettings{}, err
	}
	return LanguageSettings{Language: string(saved.Language)}, nil
}

func (s *SettingsService) SaveLanguageSettings(request SaveLanguageSettingsRequest) (LanguageSettings, error) {
	if !s.ready() {
		return LanguageSettings{}, errNotReady
	}
	saved, err := s.settings.SaveLanguage(s.ctx, settings.SaveLanguageSettingsRequest{
		Language: settings.Language(request.Language),
	})
	if errors.Is(err, settings.ErrInvalidLanguage) {
		return LanguageSettings{}, s.text.error(s.ctx,
			"Language must be en or ja.",
			"言語は en または ja を指定してください。",
		)
	}
	if err != nil {
		return LanguageSettings{}, err
	}
	return LanguageSettings{Language: string(saved.Language)}, nil
}
