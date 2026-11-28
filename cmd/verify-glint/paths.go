package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

const modulePath = "github.com/ktsu2i/glint"

// paths are the files of one verification instance. Each checkout gets its
// own state directory, derived from the repository path.
type paths struct {
	repo     string
	state    string
	binary   string
	file     string
	home     string
	dialogs  string
	appLog   string
	hostLog  string
	database string
}

// runData lists what start creates and stop deletes. The binary is kept so the
// next start can skip the build.
func (p paths) runData() []string {
	return []string{p.home, p.dialogs, p.file, p.appLog, p.hostLog}
}

func resolvePaths() (paths, error) {
	repo, err := findRepository()
	if err != nil {
		return paths{}, err
	}
	state := os.Getenv("GLINT_VERIFY_STATE")
	if state == "" {
		sum := sha256.Sum256([]byte(repo))
		state = filepath.Join(os.TempDir(), "glint-verify-"+hex.EncodeToString(sum[:4]))
	}
	home := filepath.Join(state, "home")
	return paths{
		repo:     repo,
		state:    state,
		binary:   filepath.Join(state, "bin", "glint-verify"),
		file:     filepath.Join(state, "state.json"),
		home:     home,
		dialogs:  filepath.Join(state, "dialogs"),
		appLog:   filepath.Join(state, "app.log"),
		hostLog:  filepath.Join(state, "host.log"),
		database: filepath.Join(home, "Library", "Application Support", "Glint", "library.sqlite3"),
	}, nil
}

// findRepository walks up from the working directory to the Glint module root,
// so the tool works from any directory inside the checkout.
func findRepository() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("resolve working directory: %w", err)
	}
	for {
		data, err := os.ReadFile(filepath.Join(dir, "go.mod"))
		if err == nil && bytes.HasPrefix(data, []byte("module "+modulePath+"\n")) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("run verify-glint inside the Glint repository")
		}
		dir = parent
	}
}

// instance is what the host writes once the app and the page are ready.
type instance struct {
	HostPID    int       `json:"hostPid"`
	HostPort   int       `json:"hostPort"`
	AppPort    int       `json:"appPort"`
	Executable string    `json:"executable"`
	StartedAt  time.Time `json:"startedAt"`
}

func readInstance(p paths) (*instance, error) {
	data, err := os.ReadFile(p.file)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil //nolint:nilnil // no instance is a normal state, not an error
	}
	if err != nil {
		return nil, fmt.Errorf("read state: %w", err)
	}
	var state instance
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("%s is not a verify-glint state. Run `stop`: %w", p.file, err)
	}
	return &state, nil
}

func writeInstance(p paths, state instance) error {
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	if err := os.WriteFile(p.file, data, 0o600); err != nil {
		return fmt.Errorf("write state: %w", err)
	}
	return nil
}

func isAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}
