//go:build verify

package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// verifyDialogsEnv names the directory a verification driver uses to answer
// native dialogs, which a browser driving server mode cannot reach.
const verifyDialogsEnv = "GLINT_VERIFY_DIALOGS"

func newDialogs(*application.App) dialogs {
	return scriptedDialogs{dir: os.Getenv(verifyDialogsEnv)}
}

// scriptedDialogs answers each dialog from a file the driver writes beforehand
// and removes it, so one answer serves one dialog. A missing answer cancels.
// The last dialog shown is written to last-dialog so the driver can assert it.
type scriptedDialogs struct{ dir string }

func (d scriptedDialogs) chooseBookFile(ctx context.Context, title string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := d.record("open-file", title); err != nil {
		return "", err
	}
	return d.take("open-file")
}

func (d scriptedDialogs) confirm(ctx context.Context, request confirmation) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if err := d.record("confirm", request.title); err != nil {
		return false, err
	}
	answer, err := d.take("confirm")
	if err != nil {
		return false, err
	}
	return answer == "accept", nil
}

func (d scriptedDialogs) record(kind, title string) error {
	if d.dir == "" {
		return fmt.Errorf("%s is not set", verifyDialogsEnv)
	}
	if err := os.WriteFile(filepath.Join(d.dir, "last-dialog"), []byte(kind+"\n"+title+"\n"), 0o600); err != nil {
		return fmt.Errorf("record dialog: %w", err)
	}
	return nil
}

func (d scriptedDialogs) take(name string) (string, error) {
	path := filepath.Join(d.dir, name)
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read dialog answer: %w", err)
	}
	if err := os.Remove(path); err != nil {
		return "", fmt.Errorf("consume dialog answer: %w", err)
	}
	return strings.TrimSpace(string(data)), nil
}
