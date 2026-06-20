package llm

import "context"

const MaxContextRunes = 6000

type ChatRequest struct {
	RequestID   string `json:"requestId"`
	Question    string `json:"question"`
	ContextText string `json:"contextText"`
	BookName    string `json:"bookName"`
	PageNumber  int    `json:"pageNumber"`
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
