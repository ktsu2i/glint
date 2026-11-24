package llm

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

type ProviderID string

const (
	ProviderOpenRouter       ProviderID = "openrouter"
	ProviderOpenAI           ProviderID = "openai"
	ProviderAnthropic        ProviderID = "anthropic"
	ProviderGoogle           ProviderID = "google"
	ProviderOllama           ProviderID = "ollama"
	ProviderOpenAICompatible ProviderID = "openai_compatible"
)

type AuthKind string

const (
	AuthKindBearer   AuthKind = "bearer"
	AuthKindXApiKey  AuthKind = "x-api-key"
	AuthKindQueryKey AuthKind = "query-key"
	AuthKindNone     AuthKind = "none"
)

type ProviderOptionType string

const (
	ProviderOptionString  ProviderOptionType = "string"
	ProviderOptionBool    ProviderOptionType = "bool"
	ProviderOptionURL     ProviderOptionType = "url"
	ProviderOptionHeaders ProviderOptionType = "headers"
)

type ProviderOption struct {
	Key      string             `json:"key"`
	Label    string             `json:"label"`
	Type     ProviderOptionType `json:"type"`
	Required bool               `json:"required"`
	Default  any                `json:"default,omitempty"`
	HelpText string             `json:"helpText,omitempty"`
}

type ProviderCapabilities struct {
	Streaming bool `json:"streaming"`
	Tools     bool `json:"tools"`
	Images    bool `json:"images"`
}

type ProviderDescriptor struct {
	ID             ProviderID           `json:"id"`
	DisplayName    string               `json:"displayName"`
	AuthKind       AuthKind             `json:"authKind"`
	DefaultBaseURL string               `json:"defaultBaseUrl,omitempty"`
	OptionSchema   []ProviderOption     `json:"optionSchema"`
	Capabilities   ProviderCapabilities `json:"capabilities"`
	Notes          string               `json:"notes,omitempty"`
}

type ProviderConfig struct {
	ProviderID   ProviderID     `json:"providerId"`
	DisplayLabel string         `json:"displayLabel,omitempty"`
	Model        string         `json:"model"`
	Options      map[string]any `json:"options,omitempty"`
}

type Deps struct {
	APIKey string
	Model  ModelDescriptor
}

type gatewayFactory func(cfg ProviderConfig, deps Deps) (Gateway, error)

type modelLister func(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error)

type providerEntry struct {
	descriptor ProviderDescriptor
	factory    gatewayFactory
	validate   func(cfg ProviderConfig) error
	lister     modelLister
}

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

func (r *Registry) Build(cfg ProviderConfig, deps Deps) (Gateway, error) {
	entry, ok := r.lookupEntry(cfg.ProviderID)
	if !ok {
		return nil, fmt.Errorf("unknown LLM provider %q", cfg.ProviderID)
	}
	return entry.factory(cfg, deps)
}

func (r *Registry) HasListing(id ProviderID) bool {
	entry, ok := r.lookupEntry(id)
	if !ok {
		return false
	}
	return entry.lister != nil
}

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

func (descriptor ProviderDescriptor) RequiresAPIKey() bool {
	return descriptor.AuthKind != AuthKindNone
}

func openRouterDescriptor() ProviderDescriptor {
	return ProviderDescriptor{
		ID:             ProviderOpenRouter,
		DisplayName:    "OpenRouter",
		AuthKind:       AuthKindBearer,
		DefaultBaseURL: OpenRouterEndpoint,
		OptionSchema:   []ProviderOption{},
		Capabilities:   ProviderCapabilities{Streaming: true},
		Notes:          "OpenRouter request は常に Zero Data Retention を有効にします。",
	}
}

func openRouterFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	return NewOpenRouterGateway(OpenRouterConfig{
		APIKey:        deps.APIKey,
		Model:         cfg.Model,
		ModelMetadata: deps.Model,
	})
}

func validateOpenRouter(cfg ProviderConfig) error {
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
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
		OptionSchema:   []ProviderOption{},
		Capabilities:   ProviderCapabilities{Streaming: true},
		Notes:          "modelには `gpt-5` のようなOpenAI公式のmodel idを指定してください。",
	}
}

func openAIFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	return NewOpenAIGateway(OpenAIConfig{
		APIKey:        deps.APIKey,
		Model:         cfg.Model,
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
		DisplayName:    "Anthropic",
		AuthKind:       AuthKindXApiKey,
		DefaultBaseURL: AnthropicDefaultEndpoint,
		OptionSchema:   []ProviderOption{},
		Capabilities:   ProviderCapabilities{Streaming: true},
		Notes:          "modelには `claude-opus-4-7` のようなAnthropic公式のmodel idを指定してください。",
	}
}

func anthropicFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	return NewAnthropicGateway(AnthropicConfig{
		APIKey:        deps.APIKey,
		Model:         cfg.Model,
		ModelMetadata: deps.Model,
	})
}

func validateAnthropic(cfg ProviderConfig) error {
	_ = cfg
	return nil
}

func googleDescriptor() ProviderDescriptor {
	return ProviderDescriptor{
		ID:             ProviderGoogle,
		DisplayName:    "Google",
		AuthKind:       AuthKindXApiKey,
		DefaultBaseURL: GoogleDefaultBaseURL,
		OptionSchema:   []ProviderOption{},
		Capabilities:   ProviderCapabilities{Streaming: true},
		Notes:          "modelには `gemini-2.5-pro` のようなGoogle公式のmodel idを指定してください。Generative Language APIの有効化が必要です。",
	}
}

func googleFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	return NewGoogleGateway(GoogleConfig{
		APIKey:        deps.APIKey,
		Model:         cfg.Model,
		ModelMetadata: deps.Model,
	})
}

func validateGoogle(cfg ProviderConfig) error {
	_ = cfg
	return nil
}

func ollamaDescriptor() ProviderDescriptor {
	return ProviderDescriptor{
		ID:             ProviderOllama,
		DisplayName:    "Ollama",
		AuthKind:       AuthKindNone,
		DefaultBaseURL: OllamaDefaultBaseURL,
		OptionSchema:   []ProviderOption{},
		Capabilities:   ProviderCapabilities{Streaming: true},
		Notes:          "ローカルのOllamaサーバが起動している必要があります。modelは事前に `ollama pull <model>` で取得してください。",
	}
}

func ollamaFactory(cfg ProviderConfig, deps Deps) (Gateway, error) {
	return NewOllamaGateway(OllamaConfig{
		Model:         cfg.Model,
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
