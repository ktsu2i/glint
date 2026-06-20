package llm

import (
	"context"
	"strings"
	"testing"
)

func TestMockGatewayStreamsAnswerAndCompletion(t *testing.T) {
	gateway := newMockGatewayWithDelay(0)
	stream, err := gateway.Complete(context.Background(), ChatRequest{
		RequestID:   "request-1",
		Question:    "このページを説明して",
		ContextText: "reader context",
	})
	if err != nil {
		t.Fatalf("Complete returned an error: %v", err)
	}

	var answer strings.Builder
	done := false
	for delta := range stream {
		if delta.RequestID != "request-1" {
			t.Fatalf("unexpected request ID: %s", delta.RequestID)
		}
		answer.WriteString(delta.Content)
		done = done || delta.Done
	}

	if !done {
		t.Fatal("expected a completion delta")
	}
	if !strings.Contains(answer.String(), "reader context") && !strings.Contains(answer.String(), "14文字") {
		t.Fatalf("answer did not acknowledge context: %q", answer.String())
	}
}

func TestMockGatewayValidatesRequest(t *testing.T) {
	gateway := newMockGatewayWithDelay(0)
	if _, err := gateway.Complete(context.Background(), ChatRequest{RequestID: "request-1"}); err == nil {
		t.Fatal("expected an empty question to be rejected")
	}
}

func TestTrimRunesHandlesJapaneseText(t *testing.T) {
	if got := trimRunes("あいうえお", 3); got != "あいう" {
		t.Fatalf("unexpected trimmed value: %q", got)
	}
}
