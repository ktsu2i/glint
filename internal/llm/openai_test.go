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

func TestOpenAIGatewayStreamsNormalizedAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "Bearer sk-test", request.Header.Get("Authorization"))
		assert.Equal(t, "org_xyz", request.Header.Get("OpenAI-Organization"))
		var payload openAIRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.Equal(t, "gpt-5", payload.Model)
		assert.True(t, payload.Stream)
		require.Len(t, payload.Messages, 2)
		assert.Contains(t, payload.Messages[1].Content, "reader context")
		assert.Contains(t, payload.Messages[1].Content, "why?")

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)

	gateway, err := newOpenAIGateway(OpenAIConfig{
		APIKey: "sk-test", Model: "gpt-5", Organization: "org_xyz", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)

	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID: "req-1", Question: "why?", ContextText: "reader context", BookName: "Guide", PageNumber: 7,
	})
	require.NoError(t, err)

	var answer strings.Builder
	done := false
	for delta := range stream {
		answer.WriteString(delta.Content)
		done = done || delta.Done
	}
	assert.Equal(t, "hello world", answer.String())
	assert.True(t, done)
}

func TestOpenAIGatewayMapsUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
		_, _ = writer.Write([]byte(`{"error":{"message":"invalid"}}`))
	}))
	t.Cleanup(server.Close)
	gateway, err := newOpenAIGateway(OpenAIConfig{
		APIKey: "sk", Model: "gpt-5", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	_, err = gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "OpenAI API key")
}

func TestOpenAIGatewayValidatesConfiguration(t *testing.T) {
	_, err := NewOpenAIGateway(OpenAIConfig{Model: "gpt-5"})
	assert.Error(t, err)
	_, err = NewOpenAIGateway(OpenAIConfig{APIKey: "sk"})
	assert.Error(t, err)
}

func TestOpenAIGatewayTestsConnectionWithOneToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload openAIRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.Equal(t, 1, payload.MaxCompletionTokens)
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newOpenAIGateway(OpenAIConfig{
		APIKey: "sk", Model: "gpt-5", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	require.NoError(t, gateway.TestConnection(context.Background()))
}

func TestOpenAIGatewayRedactsSecretsBeforeSending(t *testing.T) {
	var sent openAIRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		require.NoError(t, json.NewDecoder(request.Body).Decode(&sent))
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newOpenAIGateway(OpenAIConfig{
		APIKey: "sk", Model: "gpt-5", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID: "id", Question: "inspect API_KEY=super-secret-value", ContextText: "sk-proj-1234567890abcdefghijklmnop",
	})
	require.NoError(t, err)
	_ = collectDeltas(stream)
	require.Len(t, sent.Messages, 2)
	assert.NotContains(t, sent.Messages[1].Content, "super-secret-value")
	assert.Contains(t, sent.Messages[1].Content, "[REDACTED]")
}
