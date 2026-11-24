package chat

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kaito/glint/internal/llm"
)

type fakeGateway struct {
	mu          sync.Mutex
	started     chan struct{}
	delivered   chan llm.AnswerDelta
	finish      chan struct{}
	receivedCtx context.Context
}

func newFakeGateway() *fakeGateway {
	return &fakeGateway{
		started:   make(chan struct{}, 1),
		delivered: make(chan llm.AnswerDelta, 4),
		finish:    make(chan struct{}),
	}
}

func (g *fakeGateway) Complete(ctx context.Context, request llm.ChatRequest) (<-chan llm.AnswerDelta, error) {
	g.mu.Lock()
	g.receivedCtx = ctx
	g.mu.Unlock()
	stream := make(chan llm.AnswerDelta)
	go func() {
		defer close(stream)
		g.started <- struct{}{}
		for {
			select {
			case <-ctx.Done():
				return
			case delta, ok := <-g.delivered:
				if !ok {
					return
				}
				select {
				case <-ctx.Done():
					return
				case stream <- delta:
				}
			case <-g.finish:
				return
			}
		}
	}()
	return stream, nil
}

type fixedProvider struct{ gateway llm.Gateway }

func (p fixedProvider) Gateway(context.Context) (llm.Gateway, error) {
	return p.gateway, nil
}

type errorProvider struct{ err error }

func (p errorProvider) Gateway(context.Context) (llm.Gateway, error) {
	return nil, p.err
}

type recordedEvent struct {
	name string
	data []any
}

func newRecordingService(provider GatewayProvider) (*Service, <-chan recordedEvent) {
	events := make(chan recordedEvent, 8)
	svc := NewConfigured(provider)
	svc.emit = func(_ context.Context, eventName string, data ...any) {
		events <- recordedEvent{name: eventName, data: data}
	}
	Startup(svc, context.Background())
	return svc, events
}

func TestStartChatRequiresStartup(t *testing.T) {
	svc := NewConfigured(fixedProvider{gateway: newFakeGateway()})
	if err := svc.StartChat(llm.ChatRequest{RequestID: "r", Question: "q"}); err == nil {
		t.Fatal("expected error when service is not started")
	}
}

func TestStartChatSurfacesProviderConfigurationErrors(t *testing.T) {
	svc, _ := newRecordingService(errorProvider{err: errors.New("missing key")})
	if err := svc.StartChat(llm.ChatRequest{RequestID: "r", Question: "q"}); err == nil {
		t.Fatal("expected provider error")
	}
}

func TestStartChatEmitsDeltasUntilStreamCloses(t *testing.T) {
	gateway := newFakeGateway()
	svc, events := newRecordingService(fixedProvider{gateway: gateway})

	if err := svc.StartChat(llm.ChatRequest{RequestID: "req-1", Question: "hello"}); err != nil {
		t.Fatalf("StartChat: %v", err)
	}
	<-gateway.started

	gateway.delivered <- llm.AnswerDelta{RequestID: "req-1", Content: "a"}
	gateway.delivered <- llm.AnswerDelta{RequestID: "req-1", Done: true}

	first := receiveEvent(t, events)
	if delta := first.data[0].(llm.AnswerDelta); delta.Content != "a" || delta.RequestID != "req-1" {
		t.Fatalf("unexpected first delta: %#v", delta)
	}
	second := receiveEvent(t, events)
	if delta := second.data[0].(llm.AnswerDelta); !delta.Done {
		t.Fatalf("expected Done=true, got %#v", delta)
	}

	close(gateway.finish)
	waitForRelease(t, svc, "req-1")
}

func TestCancelChatStopsAnInflightRequest(t *testing.T) {
	gateway := newFakeGateway()
	svc, events := newRecordingService(fixedProvider{gateway: gateway})

	if err := svc.StartChat(llm.ChatRequest{RequestID: "req-2", Question: "hello"}); err != nil {
		t.Fatalf("StartChat: %v", err)
	}
	<-gateway.started

	svc.CancelChat("req-2")

	gateway.mu.Lock()
	ctx := gateway.receivedCtx
	gateway.mu.Unlock()
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("gateway context was not canceled")
	}

	select {
	case event := <-events:
		t.Fatalf("did not expect any deltas after cancel, got %#v", event)
	case <-time.After(50 * time.Millisecond):
	}

	waitForRelease(t, svc, "req-2")
}

func TestCancelChatIgnoresUnknownAndEmptyIDs(t *testing.T) {
	gateway := newFakeGateway()
	svc, _ := newRecordingService(fixedProvider{gateway: gateway})

	svc.CancelChat("")
	svc.CancelChat("nothing-here")
}

func TestStartChatEmitsTimeoutWhenStreamStalls(t *testing.T) {
	gateway := newFakeGateway()
	svc, events := newRecordingService(fixedProvider{gateway: gateway})
	svc.idleTimeout = 50 * time.Millisecond
	svc.totalTimeout = 2 * time.Second

	if err := svc.StartChat(llm.ChatRequest{RequestID: "req-3", Question: "hello"}); err != nil {
		t.Fatalf("StartChat: %v", err)
	}
	<-gateway.started

	event := receiveEvent(t, events)
	delta := event.data[0].(llm.AnswerDelta)
	if !delta.Done {
		t.Fatalf("expected Done=true on timeout, got %#v", delta)
	}
	if delta.Error == "" {
		t.Fatalf("expected timeout error message, got %#v", delta)
	}
	if delta.RequestID != "req-3" {
		t.Fatalf("expected timeout delta for req-3, got %#v", delta)
	}

	gateway.mu.Lock()
	ctx := gateway.receivedCtx
	gateway.mu.Unlock()
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("gateway context was not canceled by idle timeout")
	}

	waitForRelease(t, svc, "req-3")
}

func TestStartChatResetsIdleTimerOnEachDelta(t *testing.T) {
	gateway := newFakeGateway()
	svc, events := newRecordingService(fixedProvider{gateway: gateway})
	svc.idleTimeout = 80 * time.Millisecond
	svc.totalTimeout = 2 * time.Second

	if err := svc.StartChat(llm.ChatRequest{RequestID: "req-4", Question: "hello"}); err != nil {
		t.Fatalf("StartChat: %v", err)
	}
	<-gateway.started

	for range 4 {
		gateway.delivered <- llm.AnswerDelta{RequestID: "req-4", Content: "x"}
		time.Sleep(40 * time.Millisecond)
		event := receiveEvent(t, events)
		delta := event.data[0].(llm.AnswerDelta)
		if delta.Done || delta.Error != "" {
			t.Fatalf("unexpected delta: %#v", delta)
		}
	}

	gateway.delivered <- llm.AnswerDelta{RequestID: "req-4", Done: true}
	final := receiveEvent(t, events)
	delta := final.data[0].(llm.AnswerDelta)
	if !delta.Done || delta.Error != "" {
		t.Fatalf("expected clean Done delta, got %#v", delta)
	}

	waitForRelease(t, svc, "req-4")
}

func receiveEvent(t *testing.T, events <-chan recordedEvent) recordedEvent {
	t.Helper()
	select {
	case event := <-events:
		if event.name != "chat:delta" {
			t.Fatalf("unexpected event name: %s", event.name)
		}
		if len(event.data) != 1 {
			t.Fatalf("expected 1 payload, got %d", len(event.data))
		}
		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for chat delta")
		return recordedEvent{}
	}
}

func waitForRelease(t *testing.T, svc *Service, requestID string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		svc.mu.Lock()
		_, exists := svc.cancels[requestID]
		svc.mu.Unlock()
		if !exists {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("cancel func for %q was not released", requestID)
}
