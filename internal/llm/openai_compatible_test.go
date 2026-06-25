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

func TestOpenAICompatibleGatewayStreamsWithCustomHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "Bearer secret", request.Header.Get("Authorization"))
		assert.Equal(t, "tenant-42", request.Header.Get("X-Org-Id"))
		var payload openAICompatibleRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.Equal(t, "llama-3.3-70b-versatile", payload.Model)
		require.Len(t, payload.Messages, 2)
		assert.Contains(t, payload.Messages[1].Content, "question?")

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)

	gateway, err := newOpenAICompatibleGateway(OpenAICompatibleConfig{
		APIKey:         "secret",
		Model:          "llama-3.3-70b-versatile",
		BaseURL:        server.URL,
		Headers:        map[string]string{"X-Org-Id": "tenant-42"},
		RequiresAPIKey: true,
		DisplayName:    "Groq",
	}, server.Client())
	require.NoError(t, err)

	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "question?"})
	require.NoError(t, err)

	var answer strings.Builder
	for delta := range stream {
		answer.WriteString(delta.Content)
	}
	assert.Equal(t, "answer", answer.String())
}

func TestOpenAICompatibleGatewayOmitsAuthHeaderWhenKeyEmptyAndOptional(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Empty(t, request.Header.Get("Authorization"))
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)

	gateway, err := newOpenAICompatibleGateway(OpenAICompatibleConfig{
		Model:          "any",
		BaseURL:        server.URL,
		RequiresAPIKey: false,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.NoError(t, err)
	_ = collectDeltas(stream)
}

func TestOpenAICompatibleGatewayRejectsMissingRequiredKey(t *testing.T) {
	_, err := newOpenAICompatibleGateway(OpenAICompatibleConfig{
		Model:          "model",
		BaseURL:        "https://example.com",
		RequiresAPIKey: true,
	}, http.DefaultClient)
	assert.ErrorContains(t, err, "API key")
}

func TestOpenAICompatibleGatewayRejectsMissingBaseURL(t *testing.T) {
	_, err := newOpenAICompatibleGateway(OpenAICompatibleConfig{
		Model: "model",
	}, http.DefaultClient)
	assert.ErrorContains(t, err, "base URL")
}

func TestOpenAICompatibleGatewayUsesDisplayNameInErrorMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(server.Close)
	gateway, err := newOpenAICompatibleGateway(OpenAICompatibleConfig{
		APIKey: "k", Model: "m", BaseURL: server.URL, RequiresAPIKey: true, DisplayName: "Groq",
	}, server.Client())
	require.NoError(t, err)
	_, err = gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "GroqのAPI key")
}

func TestOpenAICompatibleGatewayTestsConnectionWithOneToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload openAICompatibleRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.Equal(t, 1, payload.MaxTokens)
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newOpenAICompatibleGateway(OpenAICompatibleConfig{
		Model: "model", BaseURL: server.URL, RequiresAPIKey: false,
	}, server.Client())
	require.NoError(t, err)
	require.NoError(t, gateway.TestConnection(context.Background()))
}

func TestIsOpenAICompatibleID(t *testing.T) {
	assert.True(t, IsOpenAICompatibleID(ProviderID("openai_compatible:groq")))
	assert.False(t, IsOpenAICompatibleID(ProviderID("openai_compatible")))
	assert.False(t, IsOpenAICompatibleID(ProviderID("openai_compatible:")))
	assert.False(t, IsOpenAICompatibleID(ProviderID("openai")))
}

func TestOpenAICompatibleSlug(t *testing.T) {
	assert.Equal(t, "groq", OpenAICompatibleSlug(ProviderID("openai_compatible:groq")))
	assert.Equal(t, "", OpenAICompatibleSlug(ProviderID("openai_compatible")))
}
