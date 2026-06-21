package chat

import (
	"context"
	"errors"

	"github.com/kaito/glint/internal/llm"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Service struct {
	ctx      context.Context
	provider GatewayProvider
}

type GatewayProvider interface {
	Gateway(ctx context.Context) (llm.Gateway, error)
}

type staticGatewayProvider struct{ gateway llm.Gateway }

func (provider staticGatewayProvider) Gateway(context.Context) (llm.Gateway, error) {
	return provider.gateway, nil
}

func New(gateway llm.Gateway) *Service {
	return &Service{provider: staticGatewayProvider{gateway: gateway}}
}

func NewConfigured(provider GatewayProvider) *Service {
	return &Service{provider: provider}
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
	stream, err := gateway.Complete(s.ctx, request)
	if err != nil {
		return err
	}
	go func() {
		for delta := range stream {
			runtime.EventsEmit(s.ctx, "chat:delta", delta)
		}
	}()
	return nil
}
