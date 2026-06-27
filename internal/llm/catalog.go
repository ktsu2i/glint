package llm

import (
	"context"
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
	ProviderGoogle           ProviderID = "google"
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
	// Model は active な (provider, model) の listing / builtin metadata。
	// F11 で context budget の推定に使う。zero value は ContextWindow=0 と
	// なり、FallbackBudget に落ちる（Custom OpenAI-compatible や cache 未収録
	// model はこの経路）。
	Model ModelDescriptor
}

type gatewayFactory func(cfg ProviderConfig, deps Deps) (Gateway, error)

// modelLister は provider が listing API を持つときに登録する関数。
// builtin catalog しか持たない provider (Google など) や、ローカル設定だけで
// 一覧を決める provider (custom OpenAI-compatible) は nil でよい。
type modelLister func(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error)

type providerEntry struct {
	descriptor ProviderDescriptor
	factory    gatewayFactory
	validate   func(cfg ProviderConfig) error
	lister     modelLister
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
	r.register(openRouterDescriptor(), openRouterFactory, validateOpenRouter, openRouterLister)
	r.register(openAIDescriptor(), openAIFactory, validateOpenAI, openAIModelLister)
	r.register(anthropicDescriptor(), anthropicFactory, validateAnthropic, anthropicModelLister)
	r.register(googleDescriptor(), googleFactory, validateGoogle, nil)
	r.register(ollamaDescriptor(), ollamaFactory, validateOllama, ollamaModelLister)
	r.register(openAICompatibleDescriptor(), openAICompatibleFactory, validateOpenAICompatible, nil)
}

func (r *Registry) register(descriptor ProviderDescriptor, factory gatewayFactory, validate func(ProviderConfig) error, lister modelLister) {
	r.entries[descriptor.ID] = providerEntry{descriptor: descriptor, factory: factory, validate: validate, lister: lister}
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

// HasListing は provider が listing API を持つか（= ListModels が API 値を
// 返し得るか）を返す。Manager はこれを見て api → cache → builtin の fallback
// 順を決める。
func (r *Registry) HasListing(id ProviderID) bool {
	entry, ok := r.lookupEntry(id)
	if !ok {
		return false
	}
	return entry.lister != nil
}

// ListModels は provider の listing API を呼んで結果を返す。lister が登録されて
// いない provider は nil, nil を返し、呼び出し側が builtin / cache fallback に
// 進める。
func (r *Registry) ListModels(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error) {
	entry, ok := r.lookupEntry(cfg.ProviderID)
	if !ok {
		return nil, fmt.Errorf("unknown LLM provider %q", cfg.ProviderID)
	}
	if entry.lister == nil {
		return nil, nil
	}
	return entry.lister(ctx, cfg, deps)
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
		APIKey:        deps.APIKey,
		Model:         cfg.Model,
		ZDR:           optionBool(cfg.Options, "zdr", true),
		ModelMetadata: deps.Model,
	})
}

func validateOpenRouter(cfg ProviderConfig) error {
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		// F10: model id は SetActiveModel / AddCustomModel 経由で別に管理される。
		// Upsert 時点で空のときは options だけ確認すれば良い。
		return nil
	}
	if !strings.Contains(model, "/") {
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
		APIKey:        deps.APIKey,
		Model:         cfg.Model,
		Organization:  optionString(cfg.Options, "organization", ""),
		BaseURL:       optionString(cfg.Options, "base_url", ""),
		ModelMetadata: deps.Model,
	})
}

func validateOpenAI(cfg ProviderConfig) error {
	_ = cfg
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
		ModelMetadata:    deps.Model,
	})
}

func validateAnthropic(cfg ProviderConfig) error {
	_ = cfg
	return nil
}

func googleDescriptor() ProviderDescriptor {
	return ProviderDescriptor{
		ID:             ProviderGoogle,
		DisplayName:    "Google Gemini",
		AuthKind:       AuthKindXApiKey,
		DefaultBaseURL: GoogleDefaultBaseURL,
		OptionSchema: []ProviderOption{
			{
				Key:      "auth_mode",
				Label:    "API key送信方式",
				Type:     ProviderOptionString,
				Required: false,
				Default:  GoogleAuthModeHeader,
				HelpText: "`header`（`x-goog-api-key`）または `query`（`?key=`）。通常は `header` のままで構いません。",
			},
			{
				Key:      "api_version",
				Label:    "API version",
				Type:     ProviderOptionString,
				Required: false,
				Default:  GoogleDefaultAPIVersion,
				HelpText: "`v1beta` や `v1` などのAPI versionです。",
			},
			{
				Key:      "base_url",
				Label:    "Base URL",
				Type:     ProviderOptionURL,
				Required: false,
				HelpText: "プロキシなど別のendpointを使う場合に上書きします。空欄ならGoogle公式のendpointを使います。",
			},
		},
		Capabilities: ProviderCapabilities{Streaming: true},
		Notes:        "modelには `gemini-2.5-pro` のようなGoogle公式のmodel idを指定してください。Generative Language APIの有効化が必要です。",
	}
}

func googleFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	return NewGoogleGateway(GoogleConfig{
		APIKey:        deps.APIKey,
		Model:         cfg.Model,
		BaseURL:       optionString(cfg.Options, "base_url", ""),
		APIVersion:    optionString(cfg.Options, "api_version", ""),
		AuthMode:      optionString(cfg.Options, "auth_mode", ""),
		ModelMetadata: deps.Model,
	})
}

func validateGoogle(cfg ProviderConfig) error {
	mode := strings.ToLower(strings.TrimSpace(optionString(cfg.Options, "auth_mode", "")))
	if mode != "" && mode != GoogleAuthModeHeader && mode != GoogleAuthModeQuery {
		return errors.New("auth_modeは `header` または `query` を指定してください。")
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
	return NewOllamaGateway(OllamaConfig{
		Model:         cfg.Model,
		BaseURL:       optionString(cfg.Options, "base_url", ""),
		KeepAlive:     optionString(cfg.Options, "keep_alive", ""),
		ModelMetadata: deps.Model,
	})
}

func validateOllama(cfg ProviderConfig) error {
	_ = cfg
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
		ModelMetadata:  deps.Model,
	})
}

func validateOpenAICompatible(cfg ProviderConfig) error {
	if !IsOpenAICompatibleID(cfg.ProviderID) {
		return errors.New("openai_compatibleには `openai_compatible:<slug>` 形式のproviderIdを指定してください。")
	}
	if strings.TrimSpace(optionString(cfg.Options, "base_url", "")) == "" {
		return errors.New("base URLを入力してください。")
	}
	// model は AddCustomModel で別管理する（F10）。
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
