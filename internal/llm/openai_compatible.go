package llm

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const OpenAICompatiblePrefix = "openai_compatible"

type OpenAICompatibleConfig struct {
	APIKey         string
	Model          string
	BaseURL        string
	Headers        map[string]string
	RequiresAPIKey bool
	DisplayName    string
	ModelMetadata  ModelDescriptor
}

type OpenAICompatibleGateway struct {
	model  string
	budget ContextBudget
	client *chatCompletionsClient
}

type openAICompatibleRequest struct {
	Model     string                  `json:"model"`
	Messages  []ChatCompletionMessage `json:"messages"`
	Stream    bool                    `json:"stream"`
	MaxTokens int                     `json:"max_tokens,omitempty"`
}

func NewOpenAICompatibleGateway(config OpenAICompatibleConfig) (*OpenAICompatibleGateway, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return newOpenAICompatibleGateway(config, &http.Client{Transport: transport})
}

func newOpenAICompatibleGateway(config OpenAICompatibleConfig, httpClient *http.Client) (*OpenAICompatibleGateway, error) {
	config.APIKey = strings.TrimSpace(config.APIKey)
	config.Model = strings.TrimSpace(config.Model)
	config.BaseURL = strings.TrimSpace(config.BaseURL)
	if config.Model == "" {
		return nil, errors.New("modelを入力してください。")
	}
	if config.BaseURL == "" {
		return nil, errors.New("base URLを入力してください。")
	}
	if config.RequiresAPIKey && config.APIKey == "" {
		return nil, errors.New("API keyを入力してください。")
	}

	headers := map[string]string{}
	for key, value := range config.Headers {
		trimmedKey := strings.TrimSpace(key)
		trimmedValue := strings.TrimSpace(value)
		if trimmedKey == "" || trimmedValue == "" {
			continue
		}
		headers[trimmedKey] = trimmedValue
	}
	if config.APIKey != "" {
		headers["Authorization"] = "Bearer " + config.APIKey
	}

	providerName := config.DisplayName
	if providerName == "" {
		providerName = "OpenAI-compatible"
	}

	return &OpenAICompatibleGateway{
		model:  config.Model,
		budget: EstimateBudget(config.ModelMetadata),
		client: newChatCompletionsClient(chatCompletionsConfig{
			Endpoint:     chatCompletionsEndpoint(config.BaseURL, ""),
			Headers:      headers,
			HTTPClient:   httpClient,
			ProviderName: providerName,
			StatusErrors: map[int]string{
				http.StatusUnauthorized:    fmt.Sprintf("%sのAPI keyを確認してください。", providerName),
				http.StatusTooManyRequests: fmt.Sprintf("%sのrate limitに達しました。少し待ってから再試行してください。", providerName),
			},
		}),
	}, nil
}

func (gateway *OpenAICompatibleGateway) Complete(ctx context.Context, request ChatRequest) (<-chan AnswerDelta, error) {
	request, err := normalizeChatRequest(request, gateway.budget)
	if err != nil {
		return nil, err
	}
	body := openAICompatibleRequest{
		Model: gateway.model,
		Messages: []ChatCompletionMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: chatUserMessage(request)},
		},
		Stream: true,
	}
	return gateway.client.Stream(ctx, request.RequestID, body)
}

func (gateway *OpenAICompatibleGateway) TestConnection(ctx context.Context) error {
	stream, err := gateway.client.Stream(ctx, "connection-test", openAICompatibleRequest{
		Model: gateway.model,
		Messages: []ChatCompletionMessage{
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

func IsOpenAICompatibleID(id ProviderID) bool {
	value := string(id)
	if value == OpenAICompatiblePrefix {
		return false
	}
	prefix := OpenAICompatiblePrefix + ":"
	return strings.HasPrefix(value, prefix) && strings.TrimSpace(strings.TrimPrefix(value, prefix)) != ""
}

func OpenAICompatibleSlug(id ProviderID) string {
	if !IsOpenAICompatibleID(id) {
		return ""
	}
	return strings.TrimPrefix(string(id), OpenAICompatiblePrefix+":")
}
