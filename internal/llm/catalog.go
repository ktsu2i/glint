package llm

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ProviderID は registry 上の安定キー。設定の名前空間と credential entry 名の両方に使う。
type ProviderID string

// F4 までに対応する built-in provider id。
const (
	ProviderOpenRouter       ProviderID = "openrouter"
	ProviderOpenAI           ProviderID = "openai"
	ProviderAnthropic        ProviderID = "anthropic"
	ProviderOllama           ProviderID = "ollama"
	ProviderOpenAICompatible ProviderID = "openai_compatible" // template id。実体は :slug 付き id で扱う。
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
	r.register(openAIDescriptor(), openAIFactory, validateOpenAI)
	r.register(anthropicDescriptor(), anthropicFactory, validateAnthropic)
	r.register(ollamaDescriptor(), ollamaFactory, validateOllama)
	r.register(openAICompatibleDescriptor(), openAICompatibleFactory, validateOpenAICompatible)
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
	if IsOpenAICompatibleID(id) {
		entry, ok := r.entries[ProviderOpenAICompatible]
		if !ok {
			return ProviderDescriptor{}, false
		}
		return entry.descriptor, true
	}
	entry, ok := r.entries[id]
	if !ok {
		return ProviderDescriptor{}, false
	}
	return entry.descriptor, true
}

// Validate は provider 固有のフィールド検証を行う。
func (r *Registry) Validate(cfg ProviderConfig) error {
	entry, ok := r.lookupEntry(cfg.ProviderID)
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
	entry, ok := r.lookupEntry(cfg.ProviderID)
	if !ok {
		return nil, fmt.Errorf("unknown LLM provider %q", cfg.ProviderID)
	}
	return entry.factory(cfg, deps)
}

func (r *Registry) lookupEntry(id ProviderID) (providerEntry, bool) {
	if IsOpenAICompatibleID(id) {
		entry, ok := r.entries[ProviderOpenAICompatible]
		return entry, ok
	}
	entry, ok := r.entries[id]
	return entry, ok
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

func openAIDescriptor() ProviderDescriptor {
	return ProviderDescriptor{
		ID:             ProviderOpenAI,
		DisplayName:    "OpenAI",
		AuthKind:       AuthKindBearer,
		DefaultBaseURL: OpenAIDefaultEndpoint,
		OptionSchema: []ProviderOption{
			{
				Key:      "organization",
				Label:    "Organization ID",
				Type:     ProviderOptionString,
				Required: false,
				HelpText: "OpenAI organizationを指定する場合のみ入力してください。",
			},
			{
				Key:      "base_url",
				Label:    "Base URL",
				Type:     ProviderOptionURL,
				Required: false,
				HelpText: "Azure経由などの代替endpointを使う場合に上書きします。空欄ならOpenAI公式のendpointを使います。",
			},
		},
		Capabilities: ProviderCapabilities{Streaming: true},
		Notes:        "modelには `gpt-5` のようなOpenAI公式のmodel idを指定してください。",
	}
}

func openAIFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	return NewOpenAIGateway(OpenAIConfig{
		APIKey:       deps.APIKey,
		Model:        cfg.Model,
		Organization: optionString(cfg.Options, "organization", ""),
		BaseURL:      optionString(cfg.Options, "base_url", ""),
	})
}

func validateOpenAI(cfg ProviderConfig) error {
	if strings.TrimSpace(cfg.Model) == "" {
		return errors.New("OpenAIのmodelを入力してください。")
	}
	return nil
}

func anthropicDescriptor() ProviderDescriptor {
	return ProviderDescriptor{
		ID:             ProviderAnthropic,
		DisplayName:    "Anthropic Claude",
		AuthKind:       AuthKindXApiKey,
		DefaultBaseURL: AnthropicDefaultEndpoint,
		OptionSchema: []ProviderOption{
			{
				Key:      "anthropic_version",
				Label:    "Anthropic version",
				Type:     ProviderOptionString,
				Required: false,
				Default:  AnthropicDefaultVersion,
				HelpText: "`anthropic-version` ヘッダーの値です。通常はデフォルトのままで構いません。",
			},
			{
				Key:      "base_url",
				Label:    "Base URL",
				Type:     ProviderOptionURL,
				Required: false,
				HelpText: "プロキシなど別のendpointを使う場合に上書きします。空欄ならAnthropic公式のendpointを使います。",
			},
		},
		Capabilities: ProviderCapabilities{Streaming: true},
		Notes:        "modelには `claude-opus-4-7` のようなAnthropic公式のmodel idを指定してください。",
	}
}

func anthropicFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	return NewAnthropicGateway(AnthropicConfig{
		APIKey:           deps.APIKey,
		Model:            cfg.Model,
		BaseURL:          optionString(cfg.Options, "base_url", ""),
		AnthropicVersion: optionString(cfg.Options, "anthropic_version", ""),
	})
}

func validateAnthropic(cfg ProviderConfig) error {
	if strings.TrimSpace(cfg.Model) == "" {
		return errors.New("Anthropicのmodelを入力してください。")
	}
	return nil
}

func ollamaDescriptor() ProviderDescriptor {
	return ProviderDescriptor{
		ID:             ProviderOllama,
		DisplayName:    "Ollama (local)",
		AuthKind:       AuthKindNone,
		DefaultBaseURL: OllamaDefaultBaseURL,
		OptionSchema: []ProviderOption{
			{
				Key:      "base_url",
				Label:    "Base URL",
				Type:     ProviderOptionURL,
				Required: false,
				Default:  OllamaDefaultBaseURL,
				HelpText: "Ollamaのbase URLです。デフォルトは http://localhost:11434/v1 です。",
			},
			{
				Key:      "keep_alive",
				Label:    "Keep alive",
				Type:     ProviderOptionString,
				Required: false,
				HelpText: "modelをメモリに保持する時間（例: `5m`）。空欄ならOllamaのデフォルトに従います。",
			},
		},
		Capabilities: ProviderCapabilities{Streaming: true},
		Notes:        "ローカルのOllamaサーバが起動している必要があります。modelは事前に `ollama pull <model>` で取得してください。",
	}
}

func ollamaFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	_ = deps
	return NewOllamaGateway(OllamaConfig{
		Model:     cfg.Model,
		BaseURL:   optionString(cfg.Options, "base_url", ""),
		KeepAlive: optionString(cfg.Options, "keep_alive", ""),
	})
}

func validateOllama(cfg ProviderConfig) error {
	if strings.TrimSpace(cfg.Model) == "" {
		return errors.New("Ollamaのmodelを入力してください。")
	}
	return nil
}

func openAICompatibleDescriptor() ProviderDescriptor {
	return ProviderDescriptor{
		ID:          ProviderOpenAICompatible,
		DisplayName: "OpenAI-compatible",
		AuthKind:    AuthKindBearer,
		OptionSchema: []ProviderOption{
			{
				Key:      "base_url",
				Label:    "Base URL",
				Type:     ProviderOptionURL,
				Required: true,
				HelpText: "OpenAI互換endpointのbase URL（例: https://api.groq.com/openai/v1）。",
			},
			{
				Key:      "requires_api_key",
				Label:    "API keyが必要",
				Type:     ProviderOptionBool,
				Required: false,
				Default:  true,
				HelpText: "endpointが認証不要な場合のみoffにしてください。",
			},
			{
				Key:      "headers",
				Label:    "Custom headers",
				Type:     ProviderOptionHeaders,
				Required: false,
				HelpText: "追加で送信したいHTTP headerを指定できます。",
			},
		},
		Capabilities: ProviderCapabilities{Streaming: true},
		Notes:        "送信先URLとリクエスト内容に対する責任はユーザーにあります。社内・third-party endpointを設定する際は規約とプライバシーを確認してください。",
	}
}

func openAICompatibleFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	displayName := strings.TrimSpace(cfg.DisplayLabel)
	if displayName == "" {
		if slug := OpenAICompatibleSlug(cfg.ProviderID); slug != "" {
			displayName = slug
		}
	}
	return NewOpenAICompatibleGateway(OpenAICompatibleConfig{
		APIKey:         deps.APIKey,
		Model:          cfg.Model,
		BaseURL:        optionString(cfg.Options, "base_url", ""),
		Headers:        optionHeaders(cfg.Options, "headers"),
		RequiresAPIKey: optionBool(cfg.Options, "requires_api_key", true),
		DisplayName:    displayName,
	})
}

func validateOpenAICompatible(cfg ProviderConfig) error {
	if !IsOpenAICompatibleID(cfg.ProviderID) {
		return errors.New("openai_compatibleには `openai_compatible:<slug>` 形式のproviderIdを指定してください。")
	}
	if strings.TrimSpace(cfg.Model) == "" {
		return errors.New("modelを入力してください。")
	}
	if strings.TrimSpace(optionString(cfg.Options, "base_url", "")) == "" {
		return errors.New("base URLを入力してください。")
	}
	return nil
}

func optionString(options map[string]any, key string, fallback string) string {
	if options == nil {
		return fallback
	}
	value, ok := options[key]
	if !ok {
		return fallback
	}
	if str, ok := value.(string); ok {
		return strings.TrimSpace(str)
	}
	return fallback
}

func optionHeaders(options map[string]any, key string) map[string]string {
	if options == nil {
		return nil
	}
	value, ok := options[key]
	if !ok {
		return nil
	}
	raw, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(raw))
	for headerKey, headerValue := range raw {
		if str, ok := headerValue.(string); ok {
			out[headerKey] = str
		}
	}
	return out
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
