package llm

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

const OpenRouterEndpoint = "https://openrouter.ai/api/v1/chat/completions"

type OpenRouterConfig struct {
	APIKey        string
	Model         string
	ZDR           bool
	Endpoint      string
	ModelMetadata ModelDescriptor
}

type OpenRouterGateway struct {
	model  string
	zdr    bool
	budget ContextBudget
	client *chatCompletionsClient
}

type openRouterRequest struct {
	Model     string                   `json:"model"`
	Messages  []ChatCompletionMessage  `json:"messages"`
	Stream    bool                     `json:"stream"`
	MaxTokens int                      `json:"max_tokens,omitempty"`
	Provider  openRouterProviderPolicy `json:"provider"`
}

type openRouterProviderPolicy struct {
	ZDR bool `json:"zdr"`
}

func NewOpenRouterGateway(config OpenRouterConfig) (*OpenRouterGateway, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return newOpenRouterGateway(config, &http.Client{Transport: transport})
}

func newOpenRouterGateway(config OpenRouterConfig, httpClient *http.Client) (*OpenRouterGateway, error) {
	config.APIKey = strings.TrimSpace(config.APIKey)
	config.Model = strings.TrimSpace(config.Model)
	config.Endpoint = strings.TrimSpace(config.Endpoint)
	if config.APIKey == "" {
		return nil, errors.New("OpenRouter API key is not configured")
	}
	if config.Model == "" {
		return nil, errors.New("OpenRouter model is not configured")
	}
	if config.Endpoint == "" {
		config.Endpoint = OpenRouterEndpoint
	}
	return &OpenRouterGateway{
		model:  config.Model,
		zdr:    config.ZDR,
		budget: EstimateBudget(config.ModelMetadata),
		client: newChatCompletionsClient(chatCompletionsConfig{
			Endpoint: config.Endpoint,
			Headers: map[string]string{
				"Authorization":      "Bearer " + config.APIKey,
				"X-OpenRouter-Title": "Glint",
			},
			HTTPClient:   httpClient,
			ProviderName: "OpenRouter",
			StatusErrors: map[int]string{
				http.StatusUnauthorized:    "OpenRouter API keyを確認してください。",
				http.StatusPaymentRequired: "OpenRouterのcredit残高を確認してください。",
				http.StatusTooManyRequests: "OpenRouterのrate limitに達しました。少し待ってから再試行してください。",
			},
		}),
	}, nil
}

func (gateway *OpenRouterGateway) Complete(ctx context.Context, request ChatRequest) (<-chan AnswerDelta, error) {
	request, err := normalizeChatRequest(request, gateway.budget)
	if err != nil {
		return nil, err
	}
	body := openRouterRequest{
		Model: gateway.model,
		Messages: []ChatCompletionMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: chatUserMessage(request)},
		},
		Stream:   true,
		Provider: openRouterProviderPolicy{ZDR: gateway.zdr},
	}
	return gateway.client.Stream(ctx, request.RequestID, body)
}

func (gateway *OpenRouterGateway) TestConnection(ctx context.Context) error {
	stream, err := gateway.client.Stream(ctx, "connection-test", openRouterRequest{
		Model: gateway.model,
		Messages: []ChatCompletionMessage{
			{Role: "user", Content: "Reply with OK."},
		},
		Stream:    true,
		MaxTokens: 1,
		Provider:  openRouterProviderPolicy{ZDR: gateway.zdr},
	})
	if err != nil {
		return err
	}
	return awaitConnectionTest(ctx, stream)
}
