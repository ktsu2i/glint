package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGoogleGatewayStreamsCandidateText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "test-key", request.Header.Get("x-goog-api-key"))
		assert.Equal(t, "application/json", request.Header.Get("Content-Type"))
		assert.Equal(t, "text/event-stream", request.Header.Get("Accept"))
		assert.Equal(t, "sse", request.URL.Query().Get("alt"))
		assert.Empty(t, request.URL.Query().Get("key"))
		assert.Contains(t, request.URL.Path, "/v1beta/models/gemini-2.5-pro:streamGenerateContent")

		var payload googleRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		require.Len(t, payload.Contents, 1)
		assert.Equal(t, "user", payload.Contents[0].Role)
		assert.Contains(t, payload.Contents[0].Parts[0].Text, "reader context")
		assert.Contains(t, payload.Contents[0].Parts[0].Text, "why?")
		require.NotNil(t, payload.SystemInstruction)
		assert.Equal(t, systemPrompt, payload.SystemInstruction.Parts[0].Text)

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte(": ping comment\n\n"))
		_, _ = writer.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hello\"}],\"role\":\"model\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" world\"}],\"role\":\"model\"},\"finishReason\":\"STOP\"}]}\n\n"))
	}))
	t.Cleanup(server.Close)

	gateway, err := newGoogleGateway(GoogleConfig{
		APIKey: "test-key", Model: "gemini-2.5-pro", BaseURL: server.URL,
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

func TestGoogleGatewayUsesQueryAuthMode(t *testing.T) {
	var receivedKey string
	var receivedHeader string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		receivedKey = request.URL.Query().Get("key")
		receivedHeader = request.Header.Get("x-goog-api-key")
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ok\"}]},\"finishReason\":\"STOP\"}]}\n\n"))
	}))
	t.Cleanup(server.Close)

	gateway, err := newGoogleGateway(GoogleConfig{
		APIKey: "query-key", Model: "gemini-2.5-pro", BaseURL: server.URL, AuthMode: GoogleAuthModeQuery,
	}, server.Client())
	require.NoError(t, err)

	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.NoError(t, err)
	_ = collectDeltas(stream)
	assert.Equal(t, "query-key", receivedKey)
	assert.Empty(t, receivedHeader)
}

func TestGoogleGatewayMapsHTTPFailures(t *testing.T) {
	tests := []struct {
		status  int
		message string
	}{
		{http.StatusUnauthorized, "API key"},
		{http.StatusForbidden, "権限"},
		{http.StatusTooManyRequests, "rate limit"},
		{http.StatusBadGateway, "quota exhausted"},
	}
	for _, test := range tests {
		t.Run(http.StatusText(test.status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				_, _ = writer.Write([]byte(`{"error":{"code":429,"message":"quota exhausted","status":"RESOURCE_EXHAUSTED"}}`))
			}))
			defer server.Close()
			gateway, err := newGoogleGateway(GoogleConfig{
				APIKey: "sk", Model: "gemini-2.5-pro", BaseURL: server.URL,
			}, server.Client())
			require.NoError(t, err)
			_, err = gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "question"})
			require.Error(t, err)
			assert.Contains(t, err.Error(), test.message)
		})
	}
}

func TestGoogleGatewaySurfacesStreamErrorChunk(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"error\":{\"code\":500,\"message\":\"internal failure\",\"status\":\"INTERNAL\"}}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newGoogleGateway(GoogleConfig{
		APIKey: "sk", Model: "gemini-2.5-pro", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.NoError(t, err)
	deltas := collectDeltas(stream)
	require.Len(t, deltas, 1)
	assert.True(t, deltas[0].Done)
	assert.Equal(t, "internal failure", deltas[0].Error)
}

func TestGoogleGatewaySurfacesPromptBlock(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"promptFeedback\":{\"blockReason\":\"SAFETY\"}}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newGoogleGateway(GoogleConfig{
		APIKey: "sk", Model: "gemini-2.5-pro", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.NoError(t, err)
	deltas := collectDeltas(stream)
	require.Len(t, deltas, 1)
	assert.True(t, deltas[0].Done)
	assert.Contains(t, deltas[0].Error, "SAFETY")
}

func TestGoogleGatewayReportsIncompleteStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"partial\"}]}}]}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newGoogleGateway(GoogleConfig{
		APIKey: "sk", Model: "gemini-2.5-pro", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.NoError(t, err)
	deltas := collectDeltas(stream)
	require.NotEmpty(t, deltas)
	last := deltas[len(deltas)-1]
	assert.True(t, last.Done)
	assert.Contains(t, last.Error, "Google")
	assert.Contains(t, last.Error, "完了通知")
}

func TestGoogleGatewayValidatesConfiguration(t *testing.T) {
	_, err := NewGoogleGateway(GoogleConfig{Model: "gemini-2.5-pro"})
	assert.Error(t, err)
	_, err = NewGoogleGateway(GoogleConfig{APIKey: "sk"})
	assert.Error(t, err)
}

func TestGoogleGatewayTestsConnectionWithOneToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload googleRequest
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		require.NotNil(t, payload.GenerationConfig)
		assert.Equal(t, 1, payload.GenerationConfig.MaxOutputTokens)
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"candidates\":[{\"finishReason\":\"STOP\"}]}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newGoogleGateway(GoogleConfig{
		APIKey: "sk", Model: "gemini", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	require.NoError(t, gateway.TestConnection(context.Background()))
}

func TestGoogleGatewayRedactsSecretsBeforeSending(t *testing.T) {
	var sent googleRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		require.NoError(t, json.NewDecoder(request.Body).Decode(&sent))
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ok\"}]},\"finishReason\":\"STOP\"}]}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newGoogleGateway(GoogleConfig{
		APIKey: "sk", Model: "gemini-2.5-pro", BaseURL: server.URL,
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID: "id", Question: "inspect API_KEY=super-secret-value", ContextText: "sk-ant-api03-1234567890abcdefghijklmnop",
	})
	require.NoError(t, err)
	_ = collectDeltas(stream)
	require.Len(t, sent.Contents, 1)
	require.Len(t, sent.Contents[0].Parts, 1)
	assert.NotContains(t, sent.Contents[0].Parts[0].Text, "super-secret-value")
	assert.Contains(t, sent.Contents[0].Parts[0].Text, "[REDACTED]")
}

func TestGoogleGatewayUsesCustomAPIVersion(t *testing.T) {
	var seenPath string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		seenPath = request.URL.Path
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ok\"}]},\"finishReason\":\"STOP\"}]}\n\n"))
	}))
	t.Cleanup(server.Close)
	gateway, err := newGoogleGateway(GoogleConfig{
		APIKey: "sk", Model: "gemini-pro", BaseURL: server.URL, APIVersion: "v1",
	}, server.Client())
	require.NoError(t, err)
	stream, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "id", Question: "q"})
	require.NoError(t, err)
	_ = collectDeltas(stream)
	assert.Contains(t, seenPath, "/v1/models/gemini-pro:streamGenerateContent")
}

func TestGoogleStreamEndpointResolution(t *testing.T) {
	tests := []struct {
		name        string
		baseURL     string
		apiVersion  string
		model       string
		authMode    string
		apiKey      string
		expectQuery map[string]string
		expectPath  string
	}{
		{
			name:        "default base URL with header auth",
			baseURL:     "",
			apiVersion:  GoogleDefaultAPIVersion,
			model:       "gemini-2.5-pro",
			authMode:    GoogleAuthModeHeader,
			apiKey:      "secret",
			expectQuery: map[string]string{"alt": "sse"},
			expectPath:  "/v1beta/models/gemini-2.5-pro:streamGenerateContent",
		},
		{
			name:        "custom base URL with trailing slash and query auth",
			baseURL:     "https://proxy.example.com/",
			apiVersion:  "v1",
			model:       "gemini-pro",
			authMode:    GoogleAuthModeQuery,
			apiKey:      "secret",
			expectQuery: map[string]string{"alt": "sse", "key": "secret"},
			expectPath:  "/v1/models/gemini-pro:streamGenerateContent",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			endpoint, err := googleStreamEndpoint(test.baseURL, test.apiVersion, test.model, test.authMode, test.apiKey)
			require.NoError(t, err)
			parsed, err := url.Parse(endpoint)
			require.NoError(t, err)
			assert.Equal(t, test.expectPath, parsed.Path)
			query := parsed.Query()
			for key, expected := range test.expectQuery {
				assert.Equal(t, expected, query.Get(key), "query %s", key)
			}
		})
	}
}
