package llm

type BudgetSource string

const (
	BudgetSourceModel    BudgetSource = "model"
	BudgetSourceFallback BudgetSource = "fallback"
)

const (
	runesPerTokenEstimate = 2
	budgetHeadroomTokens  = 4096
	defaultAnswerTokens   = 8192
	maxPromptRunesCap     = 100_000
)

type ContextBudget struct {
	PromptRunes    int          `json:"promptRunes"`
	AnswerTokens   int          `json:"answerTokens"`
	RetrievalShare float64      `json:"retrievalShare"`
	Source         BudgetSource `json:"source"`
	Limit          int          `json:"limit"`
}

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
