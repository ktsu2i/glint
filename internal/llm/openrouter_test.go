package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenRouterGatewayStreamsNormalizedAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "Bearer secret-key", request.Header.Get("Authorization"))
		assert.Equal(t, "Glint", request.Header.Get("X-OpenRouter-Title"))
		var payload openRouterRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.Equal(t, "provider/model", payload.Model)
		assert.True(t, payload.Stream)
		assert.True(t, payload.Provider.ZDR)
		require.Len(t, payload.Messages, 2)
		assert.Contains(t, payload.Messages[1].Content, "reader context")
		assert.Contains(t, payload.Messages[1].Content, "why?")

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte(": OPENROUTER PROCESSING\n\n"))
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"First\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\" second\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"choices\":[],\"usage\":{\"total_tokens\":4}}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)

	gateway, err := newOpenRouterGateway(OpenRouterConfig{
		APIKey: "secret-key", Model: "provider/model", Endpoint: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID: "request-1", Question: "why?", ContextText: "reader context", BookName: "Guide", PageNumber: 7,
	})
	require.NoError(t, err)

	var answer strings.Builder
	done := false
	for delta := range stream {
		assert.Equal(t, "request-1", delta.RequestID)
		assert.Empty(t, delta.Error)
		answer.WriteString(delta.Content)
		done = done || delta.Done
	}
	assert.Equal(t, "First second", answer.String())
	assert.True(t, done)
}

func TestOpenRouterGatewayMapsHTTPFailures(t *testing.T) {
	tests := []struct {
		status  int
		message string
	}{
		{http.StatusUnauthorized, "API key"},
		{http.StatusPaymentRequired, "credit"},
		{http.StatusTooManyRequests, "rate limit"},
		{http.StatusBadGateway, "upstream failed"},
	}
	for _, test := range tests {
		t.Run(http.StatusText(test.status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				_, _ = writer.Write([]byte(`{"error":{"message":"upstream failed"}}`))
			}))
			defer server.Close()
			gateway, err := newOpenRouterGateway(OpenRouterConfig{
				APIKey: "key", Model: "provider/model", Endpoint: server.URL,
			}, server.Client())
			require.NoError(t, err)
			_, err = gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "question"})
			require.Error(t, err)
			assert.Contains(t, err.Error(), test.message)
		})
	}
}

func TestOpenRouterGatewayReportsStreamErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"error\":{\"message\":\"model unavailable\"}}\n\n"))
	}))
	defer server.Close()
	gateway, err := newOpenRouterGateway(OpenRouterConfig{
		APIKey: "key", Model: "provider/model", Endpoint: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "question"})
	require.NoError(t, err)
	deltas := collectDeltas(stream)
	require.Len(t, deltas, 1)
	assert.True(t, deltas[0].Done)
	assert.Equal(t, "model unavailable", deltas[0].Error)
}

func TestOpenRouterGatewayValidatesConfiguration(t *testing.T) {
	_, err := NewOpenRouterGateway(OpenRouterConfig{Model: "provider/model"})
	assert.Error(t, err)
	_, err = NewOpenRouterGateway(OpenRouterConfig{APIKey: "key"})
	assert.Error(t, err)
}

func TestOpenRouterGatewayTestsConnectionWithOneToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload openRouterRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.Equal(t, 1, payload.MaxTokens)
		assert.True(t, payload.Provider.ZDR)
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newOpenRouterGateway(OpenRouterConfig{
		APIKey: "key", Model: "provider/model", Endpoint: server.URL,
	}, server.Client())
	require.NoError(t, err)
	require.NoError(t, gateway.TestConnection(context.Background()))
}

func TestOpenRouterGatewayRedactsSecretsBeforeSending(t *testing.T) {
	var sent openRouterRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		require.NoError(t, json.NewDecoder(request.Body).Decode(&sent))
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()
	gateway, err := newOpenRouterGateway(OpenRouterConfig{
		APIKey: "key", Model: "provider/model", Endpoint: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID: "id", Question: "inspect API_KEY=super-secret-value", ContextText: "sk-or-v1-1234567890abcdefghijklmnop",
	})
	require.NoError(t, err)
	_ = collectDeltas(stream)
	require.Len(t, sent.Messages, 2)
	assert.NotContains(t, sent.Messages[1].Content, "super-secret-value")
	assert.NotContains(t, sent.Messages[1].Content, "sk-or-v1")
	assert.Contains(t, sent.Messages[1].Content, "[REDACTED]")
}

func collectDeltas(stream <-chan AnswerDelta) []AnswerDelta {
	var deltas []AnswerDelta
	for delta := range stream {
		deltas = append(deltas, delta)
	}
	return deltas
}
