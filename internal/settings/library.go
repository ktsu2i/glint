package settings

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

const librarySortOrderSettingKey = "library.sortOrder"

// ErrInvalidLibrarySortOrder reports a sort order the library does not offer.
var ErrInvalidLibrarySortOrder = errors.New("library sort order must be recent, added, title or progress")

// LibrarySortOrder is the order books are shown on the shelf.
type LibrarySortOrder string

const (
	LibrarySortRecent   LibrarySortOrder = "recent"
	LibrarySortAdded    LibrarySortOrder = "added"
	LibrarySortTitle    LibrarySortOrder = "title"
	LibrarySortProgress LibrarySortOrder = "progress"
)

type LibrarySettings struct {
	SortOrder LibrarySortOrder
}

func (order LibrarySortOrder) Valid() bool {
	switch order {
	case LibrarySortRecent, LibrarySortAdded, LibrarySortTitle, LibrarySortProgress:
		return true
	}
	return false
}

func (manager *Manager) GetLibrary(ctx context.Context) (LibrarySettings, error) {
	value, err := manager.store.Setting(ctx, librarySortOrderSettingKey)
	if err != nil {
		return LibrarySettings{}, err
	}
	if strings.TrimSpace(value) == "" {
		return LibrarySettings{SortOrder: LibrarySortRecent}, nil
	}
	order := LibrarySortOrder(value)
	if !order.Valid() {
		return LibrarySettings{}, fmt.Errorf("invalid saved library sort order %q", value)
	}
	return LibrarySettings{SortOrder: order}, nil
}

func (manager *Manager) SaveLibrary(ctx context.Context, request LibrarySettings) (LibrarySettings, error) {
	if !request.SortOrder.Valid() {
		return LibrarySettings{}, ErrInvalidLibrarySortOrder
	}
	if err := manager.store.SaveSetting(ctx, librarySortOrderSettingKey, string(request.SortOrder)); err != nil {
		return LibrarySettings{}, err
	}
	return request, nil
}
