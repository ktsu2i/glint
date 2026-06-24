package llm

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ProviderID は registry 上の安定キー。設定の名前空間と credential entry 名の両方に使う。
type ProviderID string

// 第1フェーズで対応する built-in provider id。
const (
	ProviderOpenRouter ProviderID = "openrouter"
)

// AuthKind は frontend が credential 入力 UI を組み立てるためのヒント。
type AuthKind string

const (
	AuthKindBearer   AuthKind = "bearer"
	AuthKindXApiKey  AuthKind = "x-api-key"
	AuthKindQueryKey AuthKind = "query-key"
	AuthKindNone     AuthKind = "none"
)

// ProviderOptionType は ProviderOption.Type の列挙値。
type ProviderOptionType string

const (
	ProviderOptionString  ProviderOptionType = "string"
	ProviderOptionBool    ProviderOptionType = "bool"
	ProviderOptionURL     ProviderOptionType = "url"
	ProviderOptionHeaders ProviderOptionType = "headers"
)

// ProviderOption は frontend がフォームを動的に組み立てるための declarative 記述。
type ProviderOption struct {
	Key      string             `json:"key"`
	Label    string             `json:"label"`
	Type     ProviderOptionType `json:"type"`
	Required bool               `json:"required"`
	Default  any                `json:"default,omitempty"`
	HelpText string             `json:"helpText,omitempty"`
}

// ProviderCapabilities は将来 UI 上で機能差を示すためのフラグ。
type ProviderCapabilities struct {
	Streaming bool `json:"streaming"`
	Tools     bool `json:"tools"`
	Images    bool `json:"images"`
}

// ProviderDescriptor は registry の公開メタデータ。UI と factory が共有する。
type ProviderDescriptor struct {
	ID             ProviderID           `json:"id"`
	DisplayName    string               `json:"displayName"`
	AuthKind       AuthKind             `json:"authKind"`
	DefaultBaseURL string               `json:"defaultBaseUrl,omitempty"`
	OptionSchema   []ProviderOption     `json:"optionSchema"`
	Capabilities   ProviderCapabilities `json:"capabilities"`
	Notes          string               `json:"notes,omitempty"`
}

// ProviderConfig は1つの provider に対するユーザー設定。secret は含まない。
type ProviderConfig struct {
	ProviderID   ProviderID     `json:"providerId"`
	DisplayLabel string         `json:"displayLabel,omitempty"`
	Model        string         `json:"model"`
	Options      map[string]any `json:"options,omitempty"`
}

// Deps は factory が gateway を組み立てるために必要な runtime 依存値。
type Deps struct {
	APIKey string
}

type gatewayFactory func(cfg ProviderConfig, deps Deps) (Gateway, error)

type providerEntry struct {
	descriptor ProviderDescriptor
	factory    gatewayFactory
	validate   func(cfg ProviderConfig) error
}

// Registry は built-in provider と将来的な user-defined slot を保持する。
type Registry struct {
	entries map[ProviderID]providerEntry
}

func NewRegistry() *Registry {
	registry := &Registry{entries: map[ProviderID]providerEntry{}}
	registry.registerBuiltins()
	return registry
}

func (r *Registry) registerBuiltins() {
	r.register(openRouterDescriptor(), openRouterFactory, validateOpenRouter)
}

func (r *Registry) register(descriptor ProviderDescriptor, factory gatewayFactory, validate func(ProviderConfig) error) {
	r.entries[descriptor.ID] = providerEntry{descriptor: descriptor, factory: factory, validate: validate}
}

// Descriptors は frontend が UI を組むための provider 一覧を返す。
func (r *Registry) Descriptors() []ProviderDescriptor {
	out := make([]ProviderDescriptor, 0, len(r.entries))
	for _, entry := range r.entries {
		out = append(out, entry.descriptor)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (r *Registry) Descriptor(id ProviderID) (ProviderDescriptor, bool) {
	entry, ok := r.entries[id]
	if !ok {
		return ProviderDescriptor{}, false
	}
	return entry.descriptor, true
}

// Validate は provider 固有のフィールド検証を行う。
func (r *Registry) Validate(cfg ProviderConfig) error {
	entry, ok := r.entries[cfg.ProviderID]
	if !ok {
		return fmt.Errorf("unknown LLM provider %q", cfg.ProviderID)
	}
	if entry.validate == nil {
		return nil
	}
	return entry.validate(cfg)
}

// Build は active provider の Gateway を組み立てる。
func (r *Registry) Build(cfg ProviderConfig, deps Deps) (Gateway, error) {
	entry, ok := r.entries[cfg.ProviderID]
	if !ok {
		return nil, fmt.Errorf("unknown LLM provider %q", cfg.ProviderID)
	}
	return entry.factory(cfg, deps)
}

// RequiresAPIKey は AuthKindNone 以外なら true。
func (descriptor ProviderDescriptor) RequiresAPIKey() bool {
	return descriptor.AuthKind != AuthKindNone
}

func openRouterDescriptor() ProviderDescriptor {
	return ProviderDescriptor{
		ID:             ProviderOpenRouter,
		DisplayName:    "OpenRouter",
		AuthKind:       AuthKindBearer,
		DefaultBaseURL: OpenRouterEndpoint,
		OptionSchema: []ProviderOption{
			{
				Key:      "zdr",
				Label:    "Zero Data Retention",
				Type:     ProviderOptionBool,
				Required: false,
				Default:  true,
				HelpText: "データを保持しないendpointだけにroutingを制限します。",
			},
		},
		Capabilities: ProviderCapabilities{Streaming: true},
		Notes:        "model は OpenRouter の provider/model 形式で指定してください。",
	}
}

func openRouterFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	return NewOpenRouterGateway(OpenRouterConfig{
		APIKey: deps.APIKey,
		Model:  cfg.Model,
		ZDR:    optionBool(cfg.Options, "zdr", true),
	})
}

func validateOpenRouter(cfg ProviderConfig) error {
	if strings.TrimSpace(cfg.Model) == "" {
		return errors.New("OpenRouterのmodelを入力してください。")
	}
	if !strings.Contains(cfg.Model, "/") {
		return errors.New("modelは provider/model 形式で入力してください。")
	}
	return nil
}

func optionBool(options map[string]any, key string, fallback bool) bool {
	if options == nil {
		return fallback
	}
	value, ok := options[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes":
			return true
		case "false", "0", "no":
			return false
		}
	}
	return fallback
}
