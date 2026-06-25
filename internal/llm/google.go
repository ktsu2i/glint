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
	"net/url"
	"strings"
	"time"
)

const (
	GoogleDefaultBaseURL    = "https://generativelanguage.googleapis.com"
	GoogleDefaultAPIVersion = "v1beta"
	GoogleAuthModeHeader    = "header"
	GoogleAuthModeQuery     = "query"
)

type GoogleConfig struct {
	APIKey     string
	Model      string
	BaseURL    string
	APIVersion string
	AuthMode   string
}

type GoogleGateway struct {
	model       string
	endpoint    string
	apiKey      string
	authMode    string
	httpClient  *http.Client
	errorMapper errorMapper
}

type googleRequest struct {
	Contents          []googleContent `json:"contents"`
	SystemInstruction *googleContent  `json:"systemInstruction,omitempty"`
}

type googleContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []googlePart `json:"parts"`
}

type googlePart struct {
	Text string `json:"text"`
}

func NewGoogleGateway(config GoogleConfig) (*GoogleGateway, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	return newGoogleGateway(config, &http.Client{Transport: transport})
}

func newGoogleGateway(config GoogleConfig, httpClient *http.Client) (*GoogleGateway, error) {
	config.APIKey = strings.TrimSpace(config.APIKey)
	config.Model = strings.TrimSpace(config.Model)
	config.BaseURL = strings.TrimSpace(config.BaseURL)
	config.APIVersion = strings.TrimSpace(config.APIVersion)
	config.AuthMode = strings.TrimSpace(strings.ToLower(config.AuthMode))
	if config.APIKey == "" {
		return nil, errors.New("Google API key is not configured")
	}
	if config.Model == "" {
		return nil, errors.New("Google model is not configured")
	}
	if config.APIVersion == "" {
		config.APIVersion = GoogleDefaultAPIVersion
	}
	if config.AuthMode != GoogleAuthModeQuery {
		config.AuthMode = GoogleAuthModeHeader
	}

	endpoint, err := googleStreamEndpoint(config.BaseURL, config.APIVersion, config.Model, config.AuthMode, config.APIKey)
	if err != nil {
		return nil, err
	}

	return &GoogleGateway{
		model:      config.Model,
		endpoint:   endpoint,
		apiKey:     config.APIKey,
		authMode:   config.AuthMode,
		httpClient: httpClient,
		errorMapper: errorMapper{
			providerName: "Google",
			overrides: map[int]string{
				http.StatusUnauthorized:    "Google API keyを確認してください。",
				http.StatusForbidden:       "Google API keyに必要な権限がありません。Generative Language APIが有効か確認してください。",
				http.StatusTooManyRequests: "Googleのrate limitに達しました。少し待ってから再試行してください。",
			},
		},
	}, nil
}

func (gateway *GoogleGateway) Complete(ctx context.Context, request ChatRequest) (<-chan AnswerDelta, error) {
	request, err := normalizeChatRequest(request)
	if err != nil {
		return nil, err
	}
	body := googleRequest{
		Contents: []googleContent{
			{Role: "user", Parts: []googlePart{{Text: chatUserMessage(request)}}},
		},
		SystemInstruction: &googleContent{
			Parts: []googlePart{{Text: systemPrompt}},
		},
	}

	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encode Google request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, gateway.endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, fmt.Errorf("create Google request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "text/event-stream")
	if gateway.authMode == GoogleAuthModeHeader {
		httpRequest.Header.Set("x-goog-api-key", gateway.apiKey)
	}

	response, err := gateway.httpClient.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("connect to Google: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		defer response.Body.Close()
		return nil, gateway.errorMapper.fromResponse(response)
	}

	stream := make(chan AnswerDelta)
	go gateway.readStream(ctx, request.RequestID, response.Body, stream)
	return stream, nil
}

type googleStreamChunk struct {
	Candidates []struct {
		Content struct {
			Parts []googlePart `json:"parts"`
			Role  string       `json:"role"`
		} `json:"content"`
		FinishReason string `json:"finishReason,omitempty"`
	} `json:"candidates"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error,omitempty"`
	PromptFeedback *struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback,omitempty"`
}

func (gateway *GoogleGateway) readStream(ctx context.Context, requestID string, body io.ReadCloser, stream chan<- AnswerDelta) {
	defer close(stream)
	defer body.Close()

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 32*1024), 1024*1024)

	finished := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}

		var chunk googleStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true, Error: gateway.errorMapper.invalidStreamChunk()})
			return
		}
		if chunk.Error != nil {
			sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true, Error: gateway.errorMapper.providerMessage(chunk.Error.Message)})
			return
		}
		if chunk.PromptFeedback != nil && chunk.PromptFeedback.BlockReason != "" {
			sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true, Error: gateway.errorMapper.providerMessage(fmt.Sprintf("プロンプトがGoogleのsafety filterでブロックされました（%s）。", chunk.PromptFeedback.BlockReason))})
			return
		}
		for _, candidate := range chunk.Candidates {
			for _, part := range candidate.Content.Parts {
				if part.Text == "" {
					continue
				}
				if !sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Content: part.Text}) {
					return
				}
			}
			if candidate.FinishReason != "" {
				finished = true
			}
		}
	}
	if ctx.Err() != nil {
		return
	}
	if err := scanner.Err(); err != nil {
		sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true, Error: gateway.errorMapper.streamInterrupted()})
		return
	}
	if finished {
		sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true})
		return
	}
	sendAnswerDelta(ctx, stream, AnswerDelta{RequestID: requestID, Done: true, Error: gateway.errorMapper.streamIncomplete()})
}

// googleStreamEndpoint はユーザー入力の base URL から `streamGenerateContent` endpoint を組み立てる。
// `?alt=sse` を強制してSSE形式で受信し、auth_mode=query なら `key=<apiKey>` を query に付ける。
func googleStreamEndpoint(baseURL, apiVersion, model, authMode, apiKey string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = GoogleDefaultBaseURL
	}
	endpoint := fmt.Sprintf("%s/%s/models/%s:streamGenerateContent", base, strings.Trim(apiVersion, "/"), model)
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("invalid Google base URL: %w", err)
	}
	query := parsed.Query()
	query.Set("alt", "sse")
	if authMode == GoogleAuthModeQuery {
		query.Set("key", apiKey)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
