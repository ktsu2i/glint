package llm

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

const OllamaDefaultBaseURL = "http://localhost:11434/v1"

type OllamaConfig struct {
	Model     string
	BaseURL   string
	KeepAlive string
}

type OllamaGateway struct {
	model     string
	keepAlive string
	client    *chatCompletionsClient
}

type ollamaRequest struct {
	Model     string                  `json:"model"`
	Messages  []ChatCompletionMessage `json:"messages"`
	Stream    bool                    `json:"stream"`
	KeepAlive string                  `json:"keep_alive,omitempty"`
	Options   map[string]any          `json:"options,omitempty"`
}

func NewOllamaGateway(config OllamaConfig) (*OllamaGateway, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return newOllamaGateway(config, &http.Client{Transport: transport})
}

func newOllamaGateway(config OllamaConfig, httpClient *http.Client) (*OllamaGateway, error) {
	config.Model = strings.TrimSpace(config.Model)
	config.BaseURL = strings.TrimSpace(config.BaseURL)
	config.KeepAlive = strings.TrimSpace(config.KeepAlive)
	if config.Model == "" {
		return nil, errors.New("Ollama model is not configured")
	}
	baseURL := config.BaseURL
	if baseURL == "" {
		baseURL = OllamaDefaultBaseURL
	}
	endpoint := chatCompletionsEndpoint(baseURL, "")

	return &OllamaGateway{
		model:     config.Model,
		keepAlive: config.KeepAlive,
		client: newChatCompletionsClient(chatCompletionsConfig{
			Endpoint:     endpoint,
			Headers:      map[string]string{},
			HTTPClient:   httpClient,
			ProviderName: "Ollama",
			StatusErrors: map[int]string{
				http.StatusNotFound: "Ollamaがmodelを認識していません。`ollama pull <model>` で取得してください。",
			},
		}),
	}, nil
}

func (gateway *OllamaGateway) Complete(ctx context.Context, request ChatRequest) (<-chan AnswerDelta, error) {
	request, err := normalizeChatRequest(request)
	if err != nil {
		return nil, err
	}
	body := ollamaRequest{
		Model: gateway.model,
		Messages: []ChatCompletionMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: chatUserMessage(request)},
		},
		Stream:    true,
		KeepAlive: gateway.keepAlive,
	}
	return gateway.client.Stream(ctx, request.RequestID, body)
}

func (gateway *OllamaGateway) TestConnection(ctx context.Context) error {
	stream, err := gateway.client.Stream(ctx, "connection-test", ollamaRequest{
		Model: gateway.model,
		Messages: []ChatCompletionMessage{
			{Role: "user", Content: "Reply with OK."},
		},
		Stream:    true,
		KeepAlive: gateway.keepAlive,
		Options:   map[string]any{"num_predict": 1},
	})
	if err != nil {
		return err
	}
	return awaitConnectionTest(ctx, stream)
}
