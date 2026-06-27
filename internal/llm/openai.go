package llm

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

const (
	OpenAIDefaultBaseURL  = "https://api.openai.com/v1"
	OpenAIDefaultEndpoint = OpenAIDefaultBaseURL + "/chat/completions"
)

type OpenAIConfig struct {
	APIKey        string
	Model         string
	Organization  string
	BaseURL       string
	ModelMetadata ModelDescriptor
}

type OpenAIGateway struct {
	model  string
	budget ContextBudget
	client *chatCompletionsClient
}

type openAIRequest struct {
	Model               string                  `json:"model"`
	Messages            []ChatCompletionMessage `json:"messages"`
	Stream              bool                    `json:"stream"`
	MaxCompletionTokens int                     `json:"max_completion_tokens,omitempty"`
}

func NewOpenAIGateway(config OpenAIConfig) (*OpenAIGateway, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return newOpenAIGateway(config, &http.Client{Transport: transport})
}

func newOpenAIGateway(config OpenAIConfig, httpClient *http.Client) (*OpenAIGateway, error) {
	config.APIKey = strings.TrimSpace(config.APIKey)
	config.Model = strings.TrimSpace(config.Model)
	config.Organization = strings.TrimSpace(config.Organization)
	config.BaseURL = strings.TrimSpace(config.BaseURL)
	if config.APIKey == "" {
		return nil, errors.New("OpenAI API key is not configured")
	}
	if config.Model == "" {
		return nil, errors.New("OpenAI model is not configured")
	}
	endpoint := chatCompletionsEndpoint(config.BaseURL, OpenAIDefaultEndpoint)

	headers := map[string]string{
		"Authorization": "Bearer " + config.APIKey,
	}
	if config.Organization != "" {
		headers["OpenAI-Organization"] = config.Organization
	}

	return &OpenAIGateway{
		model:  config.Model,
		budget: EstimateBudget(config.ModelMetadata),
		client: newChatCompletionsClient(chatCompletionsConfig{
			Endpoint:     endpoint,
			Headers:      headers,
			HTTPClient:   httpClient,
			ProviderName: "OpenAI",
			StatusErrors: map[int]string{
				http.StatusUnauthorized:    "OpenAI API keyを確認してください。",
				http.StatusPaymentRequired: "OpenAIのusage limitに達した可能性があります。billingを確認してください。",
				http.StatusTooManyRequests: "OpenAIのrate limitに達しました。少し待ってから再試行してください。",
			},
		}),
	}, nil
}

func (gateway *OpenAIGateway) Complete(ctx context.Context, request ChatRequest) (<-chan AnswerDelta, error) {
	request, err := normalizeChatRequest(request, gateway.budget)
	if err != nil {
		return nil, err
	}
	body := openAIRequest{
		Model: gateway.model,
		Messages: []ChatCompletionMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: chatUserMessage(request)},
		},
		Stream: true,
	}
	return gateway.client.Stream(ctx, request.RequestID, body)
}

func (gateway *OpenAIGateway) TestConnection(ctx context.Context) error {
	stream, err := gateway.client.Stream(ctx, "connection-test", openAIRequest{
		Model: gateway.model,
		Messages: []ChatCompletionMessage{
			{Role: "user", Content: "Reply with OK."},
		},
		Stream:              true,
		MaxCompletionTokens: 1,
	})
	if err != nil {
		return err
	}
	return awaitConnectionTest(ctx, stream)
}
