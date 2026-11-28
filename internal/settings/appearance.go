package settings

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

const appearanceThemeSettingKey = "appearance.theme"

var ErrInvalidTheme = errors.New("theme must be light, dark or system")

type Theme string

const (
	ThemeSystem Theme = "system"
	ThemeLight  Theme = "light"
	ThemeDark   Theme = "dark"
)

type AppearanceSettings struct {
	Theme Theme `json:"theme"`
}

type SaveAppearanceSettingsRequest struct {
	Theme Theme `json:"theme"`
}

func (manager *Manager) GetAppearance(ctx context.Context) (AppearanceSettings, error) {
	value, err := manager.store.Setting(ctx, appearanceThemeSettingKey)
	if err != nil {
		return AppearanceSettings{}, err
	}
	if strings.TrimSpace(value) == "" {
		return AppearanceSettings{Theme: ThemeSystem}, nil
	}
	theme := Theme(value)
	if !theme.Valid() {
		return AppearanceSettings{}, fmt.Errorf("invalid saved theme %q", value)
	}
	return AppearanceSettings{Theme: theme}, nil
}

func (manager *Manager) SaveAppearance(ctx context.Context, request SaveAppearanceSettingsRequest) (AppearanceSettings, error) {
	if !request.Theme.Valid() {
		return AppearanceSettings{}, ErrInvalidTheme
	}
	if err := manager.store.SaveSetting(ctx, appearanceThemeSettingKey, string(request.Theme)); err != nil {
		return AppearanceSettings{}, err
	}
	return AppearanceSettings{Theme: request.Theme}, nil
}

func (theme Theme) Valid() bool {
	return theme == ThemeSystem || theme == ThemeLight || theme == ThemeDark
}
