package llm

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

type MockGateway struct {
	delay time.Duration
}

func NewMockGateway() *MockGateway {
	return &MockGateway{delay: 32 * time.Millisecond}
}

func newMockGatewayWithDelay(delay time.Duration) *MockGateway {
	return &MockGateway{delay: delay}
}

func (gateway *MockGateway) Complete(ctx context.Context, request ChatRequest) (<-chan AnswerDelta, error) {
	request, err := normalizeChatRequest(request, FallbackBudget())
	if err != nil {
		return nil, err
	}

	contextDescription := "ページcontextは添付されていません。"
	if request.ContextText != "" {
		contextDescription = fmt.Sprintf("current pageから%d文字のcontextを受け取りました。", utf8.RuneCountInString(request.ContextText))
	}
	answer := fmt.Sprintf(
		"テスト用mock providerの応答です。%s 質問「%s」を受け付けました。",
		contextDescription,
		trimRunes(request.Question, 80),
	)

	stream := make(chan AnswerDelta)
	go func() {
		defer close(stream)
		for _, chunk := range splitRunes(answer, 10) {
			if gateway.delay > 0 {
				timer := time.NewTimer(gateway.delay)
				select {
				case <-ctx.Done():
					timer.Stop()
					return
				case <-timer.C:
				}
			}

			select {
			case <-ctx.Done():
				return
			case stream <- AnswerDelta{RequestID: request.RequestID, Content: chunk}:
			}
		}

		select {
		case <-ctx.Done():
			return
		case stream <- AnswerDelta{RequestID: request.RequestID, Done: true}:
		}
	}()

	return stream, nil
}

func trimRunes(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if maximum <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maximum {
		return value
	}
	return string(runes[:maximum])
}

func splitRunes(value string, chunkSize int) []string {
	if chunkSize <= 0 {
		return nil
	}
	runes := []rune(value)
	chunks := make([]string, 0, (len(runes)+chunkSize-1)/chunkSize)
	for start := 0; start < len(runes); start += chunkSize {
		end := min(start+chunkSize, len(runes))
		chunks = append(chunks, string(runes[start:end]))
	}
	return chunks
}
