package llm

// F11: provider / model ごとの context budget。retrieval pipeline 全体の token
// 化に移行する前段階として、今は rune ベースで保持する（spec §10.F11）。
//
// ModelDescriptor.ContextWindow が分からない provider（Custom OpenAI-compatible
// や cache 未取得の状態）では従来の 6000 rune を維持し、`Source=fallback` を
// frontend に返すことで「budget が model 由来か fallback か」を区別できる。

// BudgetSource は context budget の根拠。frontend が「6000 rune fallback」と
// 「provider/model から推定」を区別するために使う。
type BudgetSource string

const (
	BudgetSourceModel    BudgetSource = "model"
	BudgetSourceFallback BudgetSource = "fallback"
)

// budget 計算で使う見積もり値。token ベース移行までは粗い rune 換算で扱う。
const (
	// 日英混在のtechnicalテキストでざっくり 1 token ≈ 2 runes。
	runesPerTokenEstimate = 2
	// system prompt + chatテンプレートの余裕として常に確保しておくtoken数。
	budgetHeadroomTokens = 4096
	// MaxOutputTokens 未設定の provider に当てるデフォルト出力 budget。
	defaultAnswerTokens = 8192
	// F11 段階での prompt rune 上限。retrieval pipeline 整備（F-future）が
	// 進むまではこの cap を超えないようにし、巨大なpromptで latency と
	// privacy リスクが上がらないようにする。
	maxPromptRunesCap = 100_000
)

// ContextBudget は normalizeChatRequest が prompt を整形するために使う budget。
// frontend は ChatRequest.BudgetUsed から「どの budget が適用されたか」を読む。
type ContextBudget struct {
	PromptRunes    int          `json:"promptRunes"`
	AnswerTokens   int          `json:"answerTokens"`
	RetrievalShare float64      `json:"retrievalShare"`
	Source         BudgetSource `json:"source"`
	Limit          int          `json:"limit"`
}

// FallbackBudget は ModelDescriptor が unknown のときに使う既定 budget。
// MaxContextRunes をそのまま prompt rune limit として使い、Source=fallback で
// 返す。Custom OpenAI-compatible や cache が無い builtin 未収録 model はこれに
// 落ちる。
func FallbackBudget() ContextBudget {
	return ContextBudget{
		PromptRunes:    MaxContextRunes,
		AnswerTokens:   defaultAnswerTokens,
		RetrievalShare: defaultRetrievalShare,
		Source:         BudgetSourceFallback,
		Limit:          MaxContextRunes,
	}
}

const defaultRetrievalShare = 0.6

// EstimateBudget は ModelDescriptor の ContextWindow / MaxOutputTokens から
// context budget を推定する。ContextWindow が 0 や ヘッドルームを差し引いて
// 残らない small model は FallbackBudget に落ちる。
func EstimateBudget(model ModelDescriptor) ContextBudget {
	if model.ContextWindow <= 0 {
		return FallbackBudget()
	}
	answerTokens := model.MaxOutputTokens
	if answerTokens <= 0 {
		answerTokens = defaultAnswerTokens
	}
	availableTokens := model.ContextWindow - budgetHeadroomTokens - answerTokens
	if availableTokens <= 0 {
		// retrieval に回せる token がほぼ無い small model は安全側で fallback。
		return FallbackBudget()
	}
	promptRunes := availableTokens * runesPerTokenEstimate
	promptRunes = max(promptRunes, MaxContextRunes)
	promptRunes = min(promptRunes, maxPromptRunesCap)
	return ContextBudget{
		PromptRunes:    promptRunes,
		AnswerTokens:   answerTokens,
		RetrievalShare: defaultRetrievalShare,
		Source:         BudgetSourceModel,
		Limit:          promptRunes,
	}
}
