package llm

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMockGatewayStreamsAnswerAndCompletion(t *testing.T) {
	gateway := newMockGatewayWithDelay(0)
	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID:   "request-1",
		Question:    "このページを説明して",
		ContextText: "reader context",
	})
	require.NoError(t, err)

	var answer strings.Builder
	done := false
	for delta := range stream {
		assert.Equal(t, "request-1", delta.RequestID)
		answer.WriteString(delta.Content)
		done = done || delta.Done
	}

	assert.True(t, done, "expected a completion delta")
	assert.True(t,
		strings.Contains(answer.String(), "reader context") || strings.Contains(answer.String(), "14文字"),
		"answer did not acknowledge context: %q", answer.String(),
	)
}

func TestMockGatewayValidatesRequest(t *testing.T) {
	gateway := newMockGatewayWithDelay(0)
	_, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "request-1"})
	require.Error(t, err)
}

func TestTrimRunesHandlesJapaneseText(t *testing.T) {
	assert.Equal(t, "あいう", trimRunes("あいうえお", 3))
}
