package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	AnthropicDefaultEndpoint  = "https://api.anthropic.com/v1/messages"
	AnthropicDefaultVersion   = "2023-06-01"
	anthropicDefaultMaxTokens = 4096
)

type AnthropicConfig struct {
	APIKey           string
	Model            string
	BaseURL          string
	AnthropicVersion string
	MaxTokens        int
}

type AnthropicGateway struct {
	model            string
	endpoint         string
	apiKey           string
	anthropicVersion string
	maxTokens        int
	httpClient       *http.Client
	errorMapper      errorMapper
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
	Stream    bool               `json:"stream"`
	MaxTokens int                `json:"max_tokens"`
}

func NewAnthropicGateway(config AnthropicConfig) (*AnthropicGateway, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return newAnthropicGateway(config, &http.Client{Transport: transport})
}

func newAnthropicGateway(config AnthropicConfig, httpClient *http.Client) (*AnthropicGateway, error) {
	config.APIKey = strings.TrimSpace(config.APIKey)
	config.Model = strings.TrimSpace(config.Model)
	config.BaseURL = strings.TrimSpace(config.BaseURL)
	config.AnthropicVersion = strings.TrimSpace(config.AnthropicVersion)
	if config.APIKey == "" {
		return nil, errors.New("Anthropic API key is not configured")
	}
	if config.Model == "" {
		return nil, errors.New("Anthropic model is not configured")
	}
	if config.AnthropicVersion == "" {
		config.AnthropicVersion = AnthropicDefaultVersion
	}
	if config.MaxTokens <= 0 {
		config.MaxTokens = anthropicDefaultMaxTokens
	}

	return &AnthropicGateway{
		model:            config.Model,
		endpoint:         anthropicMessagesEndpoint(config.BaseURL, AnthropicDefaultEndpoint),
		apiKey:           config.APIKey,
		anthropicVersion: config.AnthropicVersion,
		maxTokens:        config.MaxTokens,
		httpClient:       httpClient,
		errorMapper: errorMapper{
			providerName: "Anthropic",
			overrides: map[int]string{
				http.StatusUnauthorized:    "Anthropic API keyを確認してください。",
				http.StatusForbidden:       "Anthropic API keyに必要な権限がありません。",
				http.StatusPaymentRequired: "Anthropicのusage limitに達した可能性があります。billingを確認してください。",
				http.StatusTooManyRequests: "Anthropicのrate limitに達しました。少し待ってから再試行してください。",
			},
		},
	}, nil
}

func (gateway *AnthropicGateway) Complete(ctx context.Context, request ChatRequest) (<-chan AnswerDelta, error) {
	request, err := normalizeChatRequest(request)
	if err != nil {
		return nil, err
	}
	body := anthropicRequest{
		Model:  gateway.model,
		System: systemPrompt,
		Messages: []anthropicMessage{
			{Role: "user", Content: chatUserMessage(request)},
		},
		Stream:    true,
		MaxTokens: gateway.maxTokens,
	}
	return gateway.stream(ctx, request.RequestID, body)
}

func (gateway *AnthropicGateway) TestConnection(ctx context.Context) error {
	stream, err := gateway.stream(ctx, "connection-test", anthropicRequest{
		Model: gateway.model,
		Messages: []anthropicMessage{
			{Role: "user", Content: "Reply with OK."},
		},
		Stream:    true,
		MaxTokens: 1,
	})
	if err != nil {
		return err
	}
	return awaitConnectionTest(ctx, stream)
}

func (gateway *AnthropicGateway) stream(ctx context.Context, requestID string, body anthropicRequest) (<-chan AnswerDelta, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encode Anthropic request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, gateway.endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, fmt.Errorf("create Anthropic request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "text/event-stream")
	httpRequest.Header.Set("x-api-key", gateway.apiKey)
	httpRequest.Header.Set("anthropic-version", gateway.anthropicVersion)

	response, err := gateway.httpClient.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("connect to Anthropic: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		defer response.Body.Close()
		return nil, gateway.errorMapper.fromResponse(response)
	}

	stream := make(chan AnswerDelta)
	go gateway.readStream(ctx, requestID, response.Body, stream)
	return stream, nil
}

func (gateway *AnthropicGateway) readStream(ctx context.Context, requestID string, body io.ReadCloser, stream chan<- AnswerDelta) {
	defer close(stream)
	defer body.Close()

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 32*1024), 1024*1024)

	currentEvent := ""
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			currentEvent = ""
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		if rest, ok := strings.CutPrefix(line, "event:"); ok {
			currentEvent = strings.TrimSpace(rest)
			continue
		}
		rest, ok := strings.CutPrefix(line, "data:")
		if !ok {
			continue
		}
		data := strings.TrimSpace(rest)

		switch currentEvent {
		case "content_block_delta":
			var event struct {
				Delta struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true, Error: gateway.errorMapper.invalidStreamChunk()})
				return
			}
			if event.Delta.Type != "text_delta" || event.Delta.Text == "" {
				continue
			}
			if !sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Content: event.Delta.Text}) {
				return
			}
		case "message_stop":
			sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true})
			return
		case "error":
			var event struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			_ = json.Unmarshal([]byte(data), &event)
			sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true, Error: gateway.errorMapper.providerMessage(event.Error.Message)})
			return
		}
	}
	if ctx.Err() != nil {
		return
	}
	if err := scanner.Err(); err != nil {
		sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true, Error: gateway.errorMapper.streamInterrupted()})
		return
	}
	sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true, Error: gateway.errorMapper.streamIncomplete()})
}

// anthropicMessagesEndpoint はユーザー入力の base URL から `/v1/messages` endpoint を組み立てる。
// 既に `/messages` で終わっていればそのまま使い、それ以外は `/v1/messages` を後ろに足す。
func anthropicMessagesEndpoint(baseURL, fallback string) string {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed == "" {
		return fallback
	}
	if strings.HasSuffix(trimmed, "/messages") {
		return trimmed
	}
	return strings.TrimRight(trimmed, "/") + "/v1/messages"
}
