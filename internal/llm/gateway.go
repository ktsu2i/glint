package llm

import (
	"context"
	"errors"
	"strings"

	"github.com/kaito/glint/internal/privacy"
)

const MaxContextRunes = 6000

type ChatRequest struct {
	RequestID   string         `json:"requestId"`
	Question    string         `json:"question"`
	ContextText string         `json:"contextText"`
	BookName    string         `json:"bookName"`
	PageNumber  int            `json:"pageNumber"`
	BudgetUsed  *ContextBudget `json:"budgetUsed,omitempty"`
}

type AnswerDelta struct {
	RequestID string `json:"requestId"`
	Content   string `json:"content,omitempty"`
	Done      bool   `json:"done"`
	Error     string `json:"error,omitempty"`
}

type Gateway interface {
	Complete(ctx context.Context, request ChatRequest) (<-chan AnswerDelta, error)
}

type ConnectionTester interface {
	TestConnection(ctx context.Context) error
}

func awaitConnectionTest(ctx context.Context, stream <-chan AnswerDelta) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case delta, ok := <-stream:
			if !ok {
				return errors.New("connection test stream ended unexpectedly")
			}
			if delta.Error != "" {
				return errors.New(delta.Error)
			}
			if delta.Done {
				return nil
			}
		}
	}
}

func normalizeChatRequest(request ChatRequest, budget ContextBudget) (ChatRequest, error) {
	if budget.PromptRunes <= 0 {
		budget = FallbackBudget()
	}
	request.RequestID = strings.TrimSpace(request.RequestID)
	request.Question = strings.TrimSpace(request.Question)
	request.ContextText = trimRunes(request.ContextText, budget.PromptRunes)
	request.Question = privacy.RedactKnownSecrets(request.Question)
	request.ContextText = privacy.RedactKnownSecrets(request.ContextText)
	request.BookName = strings.TrimSpace(request.BookName)
	if request.RequestID == "" {
		return ChatRequest{}, errors.New("request ID is required")
	}
	if request.Question == "" {
		return ChatRequest{}, errors.New("question is required")
	}
	budgetCopy := budget
	request.BudgetUsed = &budgetCopy
	return request, nil
}
