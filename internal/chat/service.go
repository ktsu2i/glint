package chat

import (
	"context"
	"errors"
	"sync"

	"github.com/kaito/glint/internal/llm"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Service struct {
	ctx      context.Context
	provider GatewayProvider
	emit     func(ctx context.Context, eventName string, optionalData ...any)
	mu       sync.Mutex
	cancels  map[string]context.CancelFunc
}

type GatewayProvider interface {
	Gateway(ctx context.Context) (llm.Gateway, error)
}

type staticGatewayProvider struct{ gateway llm.Gateway }

func (provider staticGatewayProvider) Gateway(context.Context) (llm.Gateway, error) {
	return provider.gateway, nil
}

func New(gateway llm.Gateway) *Service {
	return &Service{
		provider: staticGatewayProvider{gateway: gateway},
		emit:     runtime.EventsEmit,
		cancels:  map[string]context.CancelFunc{},
	}
}

func NewConfigured(provider GatewayProvider) *Service {
	return &Service{
		provider: provider,
		emit:     runtime.EventsEmit,
		cancels:  map[string]context.CancelFunc{},
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
	requestCtx, cancel := context.WithCancel(s.ctx)
	stream, err := gateway.Complete(requestCtx, request)
	if err != nil {
		cancel()
		return err
	}
	requestID := request.RequestID
	s.register(requestID, cancel)
	go func() {
		defer s.release(requestID)
		for delta := range stream {
			s.emit(s.ctx, "chat:delta", delta)
		}
	}()
	return nil
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
		cancel()
	}
}

func (s *Service) register(requestID string, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, exists := s.cancels[requestID]; exists {
		previous()
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
		cancel()
	}
}
