package app

import (
	"errors"

	"github.com/ktsu2i/glint/internal/settings"
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

// LibrarySettings are how the library shows the shelf.
type LibrarySettings struct {
	SortOrder string `json:"sortOrder"`
}

// ReaderSettings are how the reader shows books. Every book shares them.
type ReaderSettings struct {
	EPUBFontScale int    `json:"epubFontScale"`
	EPUBLayout    string `json:"epubLayout"`
}

// Settings changes are pushed to every window, so the main window follows
// what the settings window saves.
const (
	appearanceChangedEvent = "settings:appearance-changed"
	languageChangedEvent   = "settings:language-changed"
)

// eventEmitter pushes events to the frontend. Tests replace it with a fake.
type eventEmitter interface {
	Emit(name string, data ...any) bool
}

// SettingsService is bound to the frontend for the appearance and language settings.
type SettingsService struct {
	base
	settings *settings.Manager
	text     localizer
	events   eventEmitter
}

func NewSettingsService(manager *settings.Manager, events eventEmitter) *SettingsService {
	return &SettingsService{settings: manager, text: localizer{settings: manager}, events: events}
}

func (s *SettingsService) emit(name string, data any) {
	if s.events != nil {
		s.events.Emit(name, data)
	}
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
	result := AppearanceSettings{Theme: string(saved.Theme)}
	s.emit(appearanceChangedEvent, result)
	return result, nil
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
	result := LanguageSettings{Language: string(saved.Language)}
	s.emit(languageChangedEvent, result)
	return result, nil
}

func (s *SettingsService) GetReaderSettings() (ReaderSettings, error) {
	if !s.ready() {
		return ReaderSettings{}, errNotReady
	}
	saved, err := s.settings.GetReader(s.ctx)
	if err != nil {
		return ReaderSettings{}, err
	}
	return toReaderSettings(saved), nil
}

func (s *SettingsService) SaveReaderSettings(request ReaderSettings) (ReaderSettings, error) {
	if !s.ready() {
		return ReaderSettings{}, errNotReady
	}
	saved, err := s.settings.SaveReader(s.ctx, settings.ReaderSettings{
		EPUBFontScale: request.EPUBFontScale,
		EPUBLayout:    settings.EPUBLayout(request.EPUBLayout),
	})
	if errors.Is(err, settings.ErrInvalidReaderSettings) {
		return ReaderSettings{}, s.text.error(s.ctx,
			"The text size or page layout is invalid.",
			"文字サイズまたはページレイアウトの指定が不正です。",
		)
	}
	if err != nil {
		return ReaderSettings{}, err
	}
	return toReaderSettings(saved), nil
}

func toReaderSettings(saved settings.ReaderSettings) ReaderSettings {
	return ReaderSettings{EPUBFontScale: saved.EPUBFontScale, EPUBLayout: string(saved.EPUBLayout)}
}

func (s *SettingsService) GetLibrarySettings() (LibrarySettings, error) {
	if !s.ready() {
		return LibrarySettings{}, errNotReady
	}
	saved, err := s.settings.GetLibrary(s.ctx)
	if err != nil {
		return LibrarySettings{}, err
	}
	return LibrarySettings{SortOrder: string(saved.SortOrder)}, nil
}

func (s *SettingsService) SaveLibrarySettings(request LibrarySettings) (LibrarySettings, error) {
	if !s.ready() {
		return LibrarySettings{}, errNotReady
	}
	saved, err := s.settings.SaveLibrary(s.ctx, settings.LibrarySettings{
		SortOrder: settings.LibrarySortOrder(request.SortOrder),
	})
	if errors.Is(err, settings.ErrInvalidLibrarySortOrder) {
		return LibrarySettings{}, s.text.error(s.ctx,
			"The sort order must be recent, added, title, or progress.",
			"並び順は recent、added、title、progress のいずれかを指定してください。",
		)
	}
	if err != nil {
		return LibrarySettings{}, err
	}
	return LibrarySettings{SortOrder: string(saved.SortOrder)}, nil
}
