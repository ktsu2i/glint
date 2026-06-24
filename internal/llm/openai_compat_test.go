package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRequest struct {
	Model    string                  `json:"model"`
	Messages []ChatCompletionMessage `json:"messages"`
	Stream   bool                    `json:"stream"`
}

func newFakeRequest(model string, message string) fakeRequest {
	return fakeRequest{
		Model:    model,
		Messages: []ChatCompletionMessage{{Role: "user", Content: message}},
		Stream:   true,
	}
}

func TestChatCompletionsClientInjectsHeadersAndStreamsDeltas(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "Bearer test-key", request.Header.Get("Authorization"))
		assert.Equal(t, "value", request.Header.Get("X-Test-Header"))
		assert.Equal(t, "application/json", request.Header.Get("Content-Type"))
		assert.Equal(t, "text/event-stream", request.Header.Get("Accept"))

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte(": comment line\n\n"))
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)

	client := newChatCompletionsClient(chatCompletionsConfig{
		Endpoint: server.URL,
		Headers: map[string]string{
			"Authorization": "Bearer test-key",
			"X-Test-Header": "value",
		},
		HTTPClient:   server.Client(),
		ProviderName: "TestProvider",
	})

	stream, err := client.Stream(context.Background(), "req-1", newFakeRequest("model", "question"))
	require.NoError(t, err)

	var content strings.Builder
	done := false
	for delta := range stream {
		assert.Equal(t, "req-1", delta.RequestID)
		assert.Empty(t, delta.Error)
		content.WriteString(delta.Content)
		done = done || delta.Done
	}
	assert.Equal(t, "hello world", content.String())
	assert.True(t, done)
}

func TestChatCompletionsClientUsesStatusOverrides(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
		_, _ = writer.Write([]byte(`{"error":{"message":"bad key"}}`))
	}))
	t.Cleanup(server.Close)

	client := newChatCompletionsClient(chatCompletionsConfig{
		Endpoint:     server.URL,
		HTTPClient:   server.Client(),
		ProviderName: "TestProvider",
		StatusErrors: map[int]string{
			http.StatusUnauthorized: "custom unauthorized message",
		},
	})

	_, err := client.Stream(context.Background(), "req", newFakeRequest("model", "q"))
	require.Error(t, err)
	assert.Equal(t, "custom unauthorized message", err.Error())
}

func TestChatCompletionsClientFallsBackToProviderMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusBadGateway)
		_, _ = writer.Write([]byte(`{"error":{"message":"upstream failure"}}`))
	}))
	t.Cleanup(server.Close)

	client := newChatCompletionsClient(chatCompletionsConfig{
		Endpoint:     server.URL,
		HTTPClient:   server.Client(),
		ProviderName: "TestProvider",
	})

	_, err := client.Stream(context.Background(), "req", newFakeRequest("model", "q"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "TestProvider request failed (502)")
	assert.Contains(t, err.Error(), "upstream failure")
}

func TestChatCompletionsClientSurfacesStreamErrorsFromChunks(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"error\":{\"message\":\"model unavailable\"}}\n\n"))
	}))
	t.Cleanup(server.Close)

	client := newChatCompletionsClient(chatCompletionsConfig{
		Endpoint:     server.URL,
		HTTPClient:   server.Client(),
		ProviderName: "TestProvider",
	})

	stream, err := client.Stream(context.Background(), "req", newFakeRequest("model", "q"))
	require.NoError(t, err)
	deltas := collectDeltas(stream)
	require.Len(t, deltas, 1)
	assert.True(t, deltas[0].Done)
	assert.Equal(t, "model unavailable", deltas[0].Error)
}

func TestChatCompletionsClientReportsIncompleteStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"))
	}))
	t.Cleanup(server.Close)

	client := newChatCompletionsClient(chatCompletionsConfig{
		Endpoint:     server.URL,
		HTTPClient:   server.Client(),
		ProviderName: "TestProvider",
	})

	stream, err := client.Stream(context.Background(), "req", newFakeRequest("model", "q"))
	require.NoError(t, err)
	deltas := collectDeltas(stream)
	require.NotEmpty(t, deltas)
	last := deltas[len(deltas)-1]
	assert.True(t, last.Done)
	assert.Contains(t, last.Error, "TestProvider")
	assert.Contains(t, last.Error, "完了通知")
}
