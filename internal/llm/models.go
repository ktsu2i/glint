package llm

import (
	"sort"
	"strings"
	"time"
)

// ModelSource は ModelDescriptor の取得元。
// - "api"     : provider の listing API から取得した最新情報
// - "cache"   : 直近の API 結果を SQLite cache から復元したもの
// - "builtin" : Glint 内 versioned catalog の seed list（API もしくは cache が
//   未取得 / 失敗のときの最終 fallback）
type ModelSource string

const (
	ModelSourceAPI     ModelSource = "api"
	ModelSourceCache   ModelSource = "cache"
	ModelSourceBuiltin ModelSource = "builtin"
)

// ModelDescriptor は provider が提供する1つの model の正規化表現。
// listing API と built-in catalog の両方を同じ shape で扱うために用意する。
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

// ModelListing は frontend へ返す model 一覧。Source と FetchedAt は
// 「最新を取得 / cache 表示」UI を組むためのメタ情報。
type ModelListing struct {
	Models    []ModelDescriptor `json:"models"`
	Source    ModelSource       `json:"source"`
	FetchedAt time.Time         `json:"fetchedAt"`
}

// BuiltinModels は安定 listing API を持たない provider 用の seed list と、
// 取得失敗時の最終 fallback。Glint 側で versioned に管理する。
// claude-api skill / 各 provider 公式 doc を参照して定期的に更新する。
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
		// Google は安定 listing API が公式に揃っていないため builtin を主に使う。
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
		// ローカル環境はユーザーごとに pull 済 model が異なるため builtin seed は持たない。
		return nil
	}
	return nil
}

// MergeModels は a を優先して b を後ろに追加する。重複する ID は a を保つ。
// listing API 結果と builtin の合成、cache と builtin の合成に使う。
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

// SortModels は ID 昇順に安定 sort する。listing API は順序が不定なため、
// frontend に返す前にここで正規化する。
func SortModels(models []ModelDescriptor) {
	sort.SliceStable(models, func(i, j int) bool {
		return models[i].ID < models[j].ID
	})
}
