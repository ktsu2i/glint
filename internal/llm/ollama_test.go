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

func TestOllamaGatewayStreamsWithoutAuthHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Empty(t, request.Header.Get("Authorization"))
		var payload ollamaRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.Equal(t, "llama3", payload.Model)
		assert.True(t, payload.Stream)
		assert.Equal(t, "5m", payload.KeepAlive)

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)

	gateway, err := newOllamaGateway(OllamaConfig{
		Model: "llama3", BaseURL: server.URL, KeepAlive: "5m",
	}, server.Client())
	require.NoError(t, err)

	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID: "req", Question: "q",
	})
	require.NoError(t, err)
	var answer strings.Builder
	for delta := range stream {
		answer.WriteString(delta.Content)
	}
	assert.Equal(t, "hi", answer.String())
}

func TestOllamaGatewayMapsModelNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write([]byte(`{"error":"model not found"}`))
	}))
	t.Cleanup(server.Close)

	gateway, err := newOllamaGateway(OllamaConfig{Model: "llama3", BaseURL: server.URL}, server.Client())
	require.NoError(t, err)
	_, err = gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ollama pull")
}

func TestOllamaGatewayValidatesConfiguration(t *testing.T) {
	_, err := NewOllamaGateway(OllamaConfig{})
	assert.Error(t, err)
}

func TestOllamaGatewayUsesDefaultBaseURLWhenEmpty(t *testing.T) {
	gateway, err := newOllamaGateway(OllamaConfig{Model: "llama3"}, http.DefaultClient)
	require.NoError(t, err)
	assert.Equal(t, "http://localhost:11434/v1/chat/completions", gateway.client.endpoint)
}

func TestOllamaGatewayTestsConnectionWithOnePredictedToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload ollamaRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.Equal(t, float64(1), payload.Options["num_predict"])
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newOllamaGateway(OllamaConfig{Model: "llama3", BaseURL: server.URL}, server.Client())
	require.NoError(t, err)
	require.NoError(t, gateway.TestConnection(context.Background()))
}
