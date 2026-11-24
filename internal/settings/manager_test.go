package settings

import "context"

type memorySettingStore struct{ values map[string]string }

func (store *memorySettingStore) Setting(_ context.Context, key string) (string, error) {
	return store.values[key], nil
}

func (store *memorySettingStore) SaveSetting(_ context.Context, key, value string) error {
	store.values[key] = value
	return nil
}

func newTestManager() (*Manager, *memorySettingStore) {
	store := &memorySettingStore{values: map[string]string{}}
	return NewManager(store), store
}
