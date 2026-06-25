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

func TestAnthropicGatewayStreamsContentBlockDeltas(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "sk-ant-test", request.Header.Get("x-api-key"))
		assert.Equal(t, AnthropicDefaultVersion, request.Header.Get("anthropic-version"))
		assert.Equal(t, "application/json", request.Header.Get("Content-Type"))
		assert.Equal(t, "text/event-stream", request.Header.Get("Accept"))

		var payload anthropicRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.Equal(t, "claude-opus-4-7", payload.Model)
		assert.Equal(t, systemPrompt, payload.System)
		assert.True(t, payload.Stream)
		assert.Equal(t, anthropicDefaultMaxTokens, payload.MaxTokens)
		require.Len(t, payload.Messages, 1)
		assert.Equal(t, "user", payload.Messages[0].Role)
		assert.Contains(t, payload.Messages[0].Content, "reader context")
		assert.Contains(t, payload.Messages[0].Content, "why?")

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte(": ping comment\n\n"))
		_, _ = writer.Write([]byte("event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n"))
		_, _ = writer.Write([]byte("event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n"))
		_, _ = writer.Write([]byte("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"))
	}))
	t.Cleanup(server.Close)

	gateway, err := newAnthropicGateway(AnthropicConfig{
		APIKey: "sk-ant-test", Model: "claude-opus-4-7", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)

	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID: "req-1", Question: "why?", ContextText: "reader context", BookName: "Guide", PageNumber: 7,
	})
	require.NoError(t, err)

	var answer strings.Builder
	done := false
	for delta := range stream {
		assert.Equal(t, "req-1", delta.RequestID)
		assert.Empty(t, delta.Error)
		answer.WriteString(delta.Content)
		done = done || delta.Done
	}
	assert.Equal(t, "hello world", answer.String())
	assert.True(t, done)
}

func TestAnthropicGatewayIgnoresNonTextDeltas(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("event: content_block_delta\ndata: {\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"answer\"}}\n\n"))
		_, _ = writer.Write([]byte("event: message_stop\ndata: {}\n\n"))
	}))
	t.Cleanup(server.Close)

	gateway, err := newAnthropicGateway(AnthropicConfig{
		APIKey: "sk", Model: "claude", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.NoError(t, err)
	deltas := collectDeltas(stream)
	var content strings.Builder
	for _, delta := range deltas {
		content.WriteString(delta.Content)
	}
	assert.Equal(t, "answer", content.String())
	require.NotEmpty(t, deltas)
	assert.True(t, deltas[len(deltas)-1].Done)
	assert.Empty(t, deltas[len(deltas)-1].Error)
}

func TestAnthropicGatewayMapsHTTPFailures(t *testing.T) {
	tests := []struct {
		status  int
		message string
	}{
		{http.StatusUnauthorized, "API key"},
		{http.StatusForbidden, "権限"},
		{http.StatusPaymentRequired, "usage limit"},
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
			gateway, err := newAnthropicGateway(AnthropicConfig{
				APIKey: "sk", Model: "claude-opus-4-7", BaseURL: server.URL,
			}, server.Client())
			require.NoError(t, err)
			_, err = gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "question"})
			require.Error(t, err)
			assert.Contains(t, err.Error(), test.message)
		})
	}
}

func TestAnthropicGatewaySurfacesStreamError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"model overloaded\"}}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newAnthropicGateway(AnthropicConfig{
		APIKey: "sk", Model: "claude-opus-4-7", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "question"})
	require.NoError(t, err)
	deltas := collectDeltas(stream)
	require.Len(t, deltas, 1)
	assert.True(t, deltas[0].Done)
	assert.Equal(t, "model overloaded", deltas[0].Error)
}

func TestAnthropicGatewayReportsIncompleteStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("event: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"partial\"}}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newAnthropicGateway(AnthropicConfig{
		APIKey: "sk", Model: "claude-opus-4-7", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "question"})
	require.NoError(t, err)
	deltas := collectDeltas(stream)
	require.NotEmpty(t, deltas)
	last := deltas[len(deltas)-1]
	assert.True(t, last.Done)
	assert.Contains(t, last.Error, "Anthropic")
	assert.Contains(t, last.Error, "完了通知")
}

func TestAnthropicGatewayValidatesConfiguration(t *testing.T) {
	_, err := NewAnthropicGateway(AnthropicConfig{Model: "claude-opus-4-7"})
	assert.Error(t, err)
	_, err = NewAnthropicGateway(AnthropicConfig{APIKey: "sk"})
	assert.Error(t, err)
}

func TestAnthropicGatewayUsesCustomVersion(t *testing.T) {
	var received string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		received = request.Header.Get("anthropic-version")
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("event: message_stop\ndata: {}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newAnthropicGateway(AnthropicConfig{
		APIKey: "sk", Model: "claude-opus-4-7", BaseURL: server.URL, AnthropicVersion: "2024-10-22",
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.NoError(t, err)
	_ = collectDeltas(stream)
	assert.Equal(t, "2024-10-22", received)
}

func TestAnthropicGatewayRedactsSecretsBeforeSending(t *testing.T) {
	var sent anthropicRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		require.NoError(t, json.NewDecoder(request.Body).Decode(&sent))
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("event: message_stop\ndata: {}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newAnthropicGateway(AnthropicConfig{
		APIKey: "sk", Model: "claude-opus-4-7", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID: "id", Question: "inspect API_KEY=super-secret-value", ContextText: "sk-ant-api03-1234567890abcdefghijklmnop",
	})
	require.NoError(t, err)
	_ = collectDeltas(stream)
	require.Len(t, sent.Messages, 1)
	assert.NotContains(t, sent.Messages[0].Content, "super-secret-value")
	assert.Contains(t, sent.Messages[0].Content, "[REDACTED]")
}

func TestAnthropicMessagesEndpointResolution(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty falls back", "", AnthropicDefaultEndpoint},
		{"already messages endpoint", "https://example.com/v1/messages", "https://example.com/v1/messages"},
		{"appends v1/messages", "https://example.com", "https://example.com/v1/messages"},
		{"strips trailing slash", "https://example.com/", "https://example.com/v1/messages"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.expected, anthropicMessagesEndpoint(test.input, AnthropicDefaultEndpoint))
		})
	}
}
