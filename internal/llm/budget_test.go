package llm

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEstimateBudgetUsesFallbackWhenContextWindowUnknown(t *testing.T) {
	budget := EstimateBudget(ModelDescriptor{ID: "custom-model"})
	assert.Equal(t, BudgetSourceFallback, budget.Source)
	assert.Equal(t, MaxContextRunes, budget.PromptRunes)
	assert.Equal(t, MaxContextRunes, budget.Limit)
	assert.Equal(t, defaultAnswerTokens, budget.AnswerTokens)
}

func TestEstimateBudgetRelaxesForLargeContextWindow(t *testing.T) {
	model := ModelDescriptor{
		ID:              "claude-sonnet-4-6",
		ContextWindow:   200_000,
		MaxOutputTokens: 64_000,
	}
	budget := EstimateBudget(model)
	assert.Equal(t, BudgetSourceModel, budget.Source)
	assert.Equal(t, maxPromptRunesCap, budget.PromptRunes)
	assert.Equal(t, 64_000, budget.AnswerTokens)
}

func TestEstimateBudgetAppliesDefaultAnswerTokensWhenUnset(t *testing.T) {
	model := ModelDescriptor{
		ID:            "gpt-5",
		ContextWindow: 200_000,
	}
	budget := EstimateBudget(model)
	assert.Equal(t, BudgetSourceModel, budget.Source)
	assert.Equal(t, defaultAnswerTokens, budget.AnswerTokens)
	assert.GreaterOrEqual(t, budget.PromptRunes, MaxContextRunes)
}

func TestEstimateBudgetFallsBackWhenWindowTooSmall(t *testing.T) {
	// headroom(4096) + defaultAnswerTokens(8192) を引いた残りが 0 以下になる小さい
	// model は安全側で fallback に落ちる。
	model := ModelDescriptor{
		ID:            "tiny-model",
		ContextWindow: 8_000,
	}
	budget := EstimateBudget(model)
	assert.Equal(t, BudgetSourceFallback, budget.Source)
	assert.Equal(t, MaxContextRunes, budget.PromptRunes)
}

func TestEstimateBudgetClampsPromptRunesAboveMaxCap(t *testing.T) {
	// Gemini 2.5 Pro 級の 2M token window でも cap を超えないことを確認。
	model := ModelDescriptor{
		ID:            "gemini-2.5-pro",
		ContextWindow: 2_000_000,
	}
	budget := EstimateBudget(model)
	assert.Equal(t, maxPromptRunesCap, budget.PromptRunes)
}

func TestNormalizeChatRequestTrimsToBudgetLimit(t *testing.T) {
	longContext := strings.Repeat("あ", 50_000)
	budget := ContextBudget{PromptRunes: 12_000, AnswerTokens: 4096, Source: BudgetSourceModel, Limit: 12_000}
	normalized, err := normalizeChatRequest(ChatRequest{
		RequestID:   "req-1",
		Question:    "this should survive",
		ContextText: longContext,
	}, budget)
	require.NoError(t, err)
	assert.Equal(t, 12_000, utf8.RuneCountInString(normalized.ContextText))
	require.NotNil(t, normalized.BudgetUsed)
	assert.Equal(t, BudgetSourceModel, normalized.BudgetUsed.Source)
	assert.Equal(t, 12_000, normalized.BudgetUsed.Limit)
}

func TestNormalizeChatRequestFallsBackWhenBudgetZero(t *testing.T) {
	// 防御的: budget.PromptRunes が 0 のときは FallbackBudget が使われ、
	// 従来の 6000 rune に trim される。
	longContext := strings.Repeat("a", 9_000)
	normalized, err := normalizeChatRequest(ChatRequest{
		RequestID:   "req-1",
		Question:    "q",
		ContextText: longContext,
	}, ContextBudget{})
	require.NoError(t, err)
	assert.Equal(t, MaxContextRunes, utf8.RuneCountInString(normalized.ContextText))
	require.NotNil(t, normalized.BudgetUsed)
	assert.Equal(t, BudgetSourceFallback, normalized.BudgetUsed.Source)
}

func TestOpenRouterGatewayUsesModelMetadataForBudget(t *testing.T) {
	// Adapter integration: ModelMetadata 経由で渡した context window が adapter
	// の budget を引き上げ、6000 rune を超える文字列が trim されずに送信される
	// ことを確認する。
	longContext := strings.Repeat("あ", 12_000)
	gateway, err := newOpenRouterGateway(OpenRouterConfig{
		APIKey:   "key",
		Model:    "anthropic/claude-sonnet-4-6",
		Endpoint: "http://example.invalid",
		ModelMetadata: ModelDescriptor{
			ID:              "anthropic/claude-sonnet-4-6",
			ContextWindow:   200_000,
			MaxOutputTokens: 64_000,
		},
	}, nil)
	require.NoError(t, err)
	assert.Equal(t, BudgetSourceModel, gateway.budget.Source)
	assert.Equal(t, maxPromptRunesCap, gateway.budget.PromptRunes)

	normalized, err := normalizeChatRequest(ChatRequest{
		RequestID:   "req",
		Question:    "q",
		ContextText: longContext,
	}, gateway.budget)
	require.NoError(t, err)
	assert.Equal(t, 12_000, utf8.RuneCountInString(normalized.ContextText))
}

func TestOpenRouterGatewayFallsBackForUnknownModel(t *testing.T) {
	// ModelMetadata を渡さない（= ContextWindow=0）と FallbackBudget が使われ、
	// 従来通り 6000 rune に切り詰められる。Custom OpenAI-compatible や cache が
	// 空の状態の挙動を保証する。
	gateway, err := newOpenRouterGateway(OpenRouterConfig{
		APIKey:   "key",
		Model:    "custom/model",
		Endpoint: "http://example.invalid",
	}, nil)
	require.NoError(t, err)
	assert.Equal(t, BudgetSourceFallback, gateway.budget.Source)
	assert.Equal(t, MaxContextRunes, gateway.budget.PromptRunes)
}

func TestNormalizeChatRequestRedactsSecretsRegardlessOfBudget(t *testing.T) {
	budget := EstimateBudget(ModelDescriptor{ContextWindow: 200_000, MaxOutputTokens: 64_000})
	normalized, err := normalizeChatRequest(ChatRequest{
		RequestID:   "req",
		Question:    "see token sk-ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
		ContextText: "OPENAI_API_KEY=sk-ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
	}, budget)
	require.NoError(t, err)
	assert.NotContains(t, normalized.Question, "sk-ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789")
	assert.NotContains(t, normalized.ContextText, "sk-ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789")
}
