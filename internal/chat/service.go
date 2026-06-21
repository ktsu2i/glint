package chat

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/kaito/glint/internal/llm"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	// DefaultIdleTimeout aborts a streaming chat request when the upstream stops
	// sending deltas for this duration.
	DefaultIdleTimeout = 60 * time.Second
	// DefaultTotalTimeout aborts a chat request once the total time budget is
	// exhausted, regardless of progress.
	DefaultTotalTimeout = 5 * time.Minute
)

// ErrChatTimeout signals that the service aborted a request because the
// upstream stalled or exceeded the total time budget.
var ErrChatTimeout = errors.New("chat request timed out")

type Service struct {
	ctx          context.Context
	provider     GatewayProvider
	emit         func(ctx context.Context, eventName string, optionalData ...any)
	mu           sync.Mutex
	cancels      map[string]context.CancelCauseFunc
	idleTimeout  time.Duration
	totalTimeout time.Duration
}

type GatewayProvider interface {
	Gateway(ctx context.Context) (llm.Gateway, error)
}

type staticGatewayProvider struct{ gateway llm.Gateway }

func (provider staticGatewayProvider) Gateway(context.Context) (llm.Gateway, error) {
	return provider.gateway, nil
}

func New(gateway llm.Gateway) *Service {
	return newService(staticGatewayProvider{gateway: gateway})
}

func NewConfigured(provider GatewayProvider) *Service {
	return newService(provider)
}

func newService(provider GatewayProvider) *Service {
	return &Service{
		provider:     provider,
		emit:         runtime.EventsEmit,
		cancels:      map[string]context.CancelCauseFunc{},
		idleTimeout:  DefaultIdleTimeout,
		totalTimeout: DefaultTotalTimeout,
	}
}

// Startup wires the Wails runtime context into the service. It is a package
// function (not a method) so that Wails does not expose it to the frontend as
// a bound RPC.
func Startup(s *Service, ctx context.Context) {
	s.ctx = ctx
}

func (s *Service) StartChat(request llm.ChatRequest) error {
	if s.ctx == nil {
		return errors.New("application is not ready")
	}
	gateway, err := s.provider.Gateway(s.ctx)
	if err != nil {
		return err
	}
	requestCtx, cancel := context.WithCancelCause(s.ctx)
	deadline := time.AfterFunc(s.totalTimeout, func() {
		cancel(ErrChatTimeout)
	})
	stream, err := gateway.Complete(requestCtx, request)
	if err != nil {
		deadline.Stop()
		cancel(context.Canceled)
		return err
	}
	requestID := request.RequestID
	s.register(requestID, cancel)
	go s.pump(requestCtx, requestID, stream, cancel, deadline)
	return nil
}

func (s *Service) pump(
	ctx context.Context,
	requestID string,
	stream <-chan llm.AnswerDelta,
	cancel context.CancelCauseFunc,
	deadline *time.Timer,
) {
	defer s.release(requestID)
	defer deadline.Stop()

	idle := time.NewTimer(s.idleTimeout)
	defer idle.Stop()

	for {
		select {
		case delta, ok := <-stream:
			if !ok {
				if errors.Is(context.Cause(ctx), ErrChatTimeout) {
					s.emit(s.ctx, "chat:delta", llm.AnswerDelta{
						RequestID: requestID,
						Done:      true,
						Error:     "応答に時間がかかりすぎたため、質問を打ち切りました。",
					})
				}
				return
			}
			s.emit(s.ctx, "chat:delta", delta)
			if delta.Done {
				return
			}
			if !idle.Stop() {
				select {
				case <-idle.C:
				default:
				}
			}
			idle.Reset(s.idleTimeout)
		case <-idle.C:
			cancel(ErrChatTimeout)
		}
	}
}

// CancelChat aborts an in-flight request started by StartChat. It is safe to
// call with an unknown request ID; the call is a no-op in that case.
func (s *Service) CancelChat(requestID string) {
	if requestID == "" {
		return
	}
	s.mu.Lock()
	cancel, ok := s.cancels[requestID]
	if ok {
		delete(s.cancels, requestID)
	}
	s.mu.Unlock()
	if ok {
		cancel(context.Canceled)
	}
}

func (s *Service) register(requestID string, cancel context.CancelCauseFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, exists := s.cancels[requestID]; exists {
		previous(context.Canceled)
	}
	s.cancels[requestID] = cancel
}

func (s *Service) release(requestID string) {
	s.mu.Lock()
	cancel, ok := s.cancels[requestID]
	if ok {
		delete(s.cancels, requestID)
	}
	s.mu.Unlock()
	if ok {
		cancel(context.Canceled)
	}
}
