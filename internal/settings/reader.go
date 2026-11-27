package settings

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

const (
	readerEPUBFontScaleSettingKey = "reader.epubFontScale"
	readerEPUBLayoutSettingKey    = "reader.epubLayout"
)

// The EPUB text size, in percent of the book's own size.
const (
	MinEPUBFontScale     = 80
	MaxEPUBFontScale     = 200
	DefaultEPUBFontScale = 100
)

// ErrInvalidReaderSettings reports a text size out of range or an unknown layout.
var ErrInvalidReaderSettings = errors.New("invalid reader settings")

// EPUBLayout is how many pages an EPUB shows at once.
type EPUBLayout string

const (
	EPUBLayoutSingle EPUBLayout = "single"
	EPUBLayoutSpread EPUBLayout = "spread"
)

type ReaderSettings struct {
	EPUBFontScale int
	EPUBLayout    EPUBLayout
}

func (layout EPUBLayout) Valid() bool {
	return layout == EPUBLayoutSingle || layout == EPUBLayoutSpread
}

func (manager *Manager) GetReader(ctx context.Context) (ReaderSettings, error) {
	result := ReaderSettings{EPUBFontScale: DefaultEPUBFontScale, EPUBLayout: EPUBLayoutSpread}
	scale, err := manager.store.Setting(ctx, readerEPUBFontScaleSettingKey)
	if err != nil {
		return ReaderSettings{}, err
	}
	if scale = strings.TrimSpace(scale); scale != "" {
		value, err := strconv.Atoi(scale)
		if err != nil || !validEPUBFontScale(value) {
			return ReaderSettings{}, fmt.Errorf("invalid saved EPUB font scale %q", scale)
		}
		result.EPUBFontScale = value
	}
	layout, err := manager.store.Setting(ctx, readerEPUBLayoutSettingKey)
	if err != nil {
		return ReaderSettings{}, err
	}
	if layout = strings.TrimSpace(layout); layout != "" {
		if !EPUBLayout(layout).Valid() {
			return ReaderSettings{}, fmt.Errorf("invalid saved EPUB layout %q", layout)
		}
		result.EPUBLayout = EPUBLayout(layout)
	}
	return result, nil
}

func (manager *Manager) SaveReader(ctx context.Context, request ReaderSettings) (ReaderSettings, error) {
	if !validEPUBFontScale(request.EPUBFontScale) || !request.EPUBLayout.Valid() {
		return ReaderSettings{}, ErrInvalidReaderSettings
	}
	if err := manager.store.SaveSetting(ctx, readerEPUBFontScaleSettingKey, strconv.Itoa(request.EPUBFontScale)); err != nil {
		return ReaderSettings{}, err
	}
	if err := manager.store.SaveSetting(ctx, readerEPUBLayoutSettingKey, string(request.EPUBLayout)); err != nil {
		return ReaderSettings{}, err
	}
	return request, nil
}

func validEPUBFontScale(value int) bool {
	return value >= MinEPUBFontScale && value <= MaxEPUBFontScale
}
