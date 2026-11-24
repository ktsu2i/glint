package settings

import "context"

type SettingStore interface {
	Setting(ctx context.Context, key string) (string, error)
	SaveSetting(ctx context.Context, key, value string) error
}

type Manager struct {
	store SettingStore
}

func NewManager(store SettingStore) *Manager {
	return &Manager{store: store}
}
