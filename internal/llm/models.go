package llm

import (
	"sort"
	"strings"
	"time"
)

type ModelSource string

const (
	ModelSourceAPI     ModelSource = "api"
	ModelSourceCache   ModelSource = "cache"
	ModelSourceBuiltin ModelSource = "builtin"
)

type ModelDescriptor struct {
	ID              string      `json:"id"`
	DisplayName     string      `json:"displayName,omitempty"`
	ContextWindow   int         `json:"contextWindow,omitempty"`
	MaxOutputTokens int         `json:"maxOutputTokens,omitempty"`
	SupportsTools   bool        `json:"supportsTools,omitempty"`
	SupportsImages  bool        `json:"supportsImages,omitempty"`
	Source          ModelSource `json:"source,omitempty"`
	Notes           string      `json:"notes,omitempty"`
}

type ModelListing struct {
	Models    []ModelDescriptor `json:"models"`
	Source    ModelSource       `json:"source"`
	FetchedAt time.Time         `json:"fetchedAt"`
}

func BuiltinModels(providerID ProviderID) []ModelDescriptor {
	if IsOpenAICompatibleID(providerID) {
		return nil
	}
	switch providerID {
	case ProviderAnthropic:
		return []ModelDescriptor{
			{ID: "claude-opus-4-8", DisplayName: "Claude Opus 4.8", ContextWindow: 200_000, MaxOutputTokens: 32_000, SupportsTools: true, SupportsImages: true, Source: ModelSourceBuiltin},
			{ID: "claude-sonnet-4-6", DisplayName: "Claude Sonnet 4.6", ContextWindow: 200_000, MaxOutputTokens: 64_000, SupportsTools: true, SupportsImages: true, Source: ModelSourceBuiltin},
			{ID: "claude-haiku-4-5-20251001", DisplayName: "Claude Haiku 4.5", ContextWindow: 200_000, MaxOutputTokens: 32_000, SupportsTools: true, SupportsImages: true, Source: ModelSourceBuiltin},
			{ID: "claude-fable-5", DisplayName: "Claude Fable 5", ContextWindow: 200_000, MaxOutputTokens: 32_000, SupportsTools: true, Source: ModelSourceBuiltin},
		}
	case ProviderOpenAI:
		return []ModelDescriptor{
			{ID: "gpt-5", DisplayName: "GPT-5", ContextWindow: 200_000, SupportsTools: true, SupportsImages: true, Source: ModelSourceBuiltin},
			{ID: "gpt-5-mini", DisplayName: "GPT-5 mini", ContextWindow: 200_000, SupportsTools: true, SupportsImages: true, Source: ModelSourceBuiltin},
			{ID: "gpt-4.1", DisplayName: "GPT-4.1", ContextWindow: 1_000_000, SupportsTools: true, SupportsImages: true, Source: ModelSourceBuiltin},
			{ID: "o4-mini", DisplayName: "o4 mini", ContextWindow: 200_000, SupportsTools: true, Source: ModelSourceBuiltin},
		}
	case ProviderGoogle:
		return []ModelDescriptor{
			{ID: "gemini-2.5-pro", DisplayName: "Gemini 2.5 Pro", ContextWindow: 2_000_000, SupportsTools: true, SupportsImages: true, Source: ModelSourceBuiltin},
			{ID: "gemini-2.5-flash", DisplayName: "Gemini 2.5 Flash", ContextWindow: 1_000_000, SupportsTools: true, SupportsImages: true, Source: ModelSourceBuiltin},
			{ID: "gemini-2.0-flash", DisplayName: "Gemini 2.0 Flash", ContextWindow: 1_000_000, SupportsTools: true, SupportsImages: true, Source: ModelSourceBuiltin},
		}
	case ProviderOpenRouter:
		return []ModelDescriptor{
			{ID: "anthropic/claude-opus-4-8", DisplayName: "Claude Opus 4.8", ContextWindow: 200_000, Source: ModelSourceBuiltin},
			{ID: "anthropic/claude-sonnet-4-6", DisplayName: "Claude Sonnet 4.6", ContextWindow: 200_000, Source: ModelSourceBuiltin},
			{ID: "openai/gpt-5", DisplayName: "GPT-5", ContextWindow: 200_000, Source: ModelSourceBuiltin},
			{ID: "google/gemini-2.5-pro", DisplayName: "Gemini 2.5 Pro", ContextWindow: 2_000_000, Source: ModelSourceBuiltin},
		}
	case ProviderOllama:
		return nil
	}
	return nil
}

func MergeModels(primary, secondary []ModelDescriptor) []ModelDescriptor {
	if len(primary) == 0 {
		return append([]ModelDescriptor(nil), secondary...)
	}
	seen := make(map[string]struct{}, len(primary)+len(secondary))
	out := make([]ModelDescriptor, 0, len(primary)+len(secondary))
	for _, model := range primary {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, model)
	}
	for _, model := range secondary {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, model)
	}
	return out
}

func SortModels(models []ModelDescriptor) {
	sort.SliceStable(models, func(i, j int) bool {
		return models[i].ID < models[j].ID
	})
}
