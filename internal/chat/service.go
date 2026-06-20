package chat

import (
	"context"
	"errors"

	"github.com/kaito/glint/internal/llm"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Service struct {
	ctx     context.Context
	gateway llm.Gateway
}

func New(gateway llm.Gateway) *Service {
	return &Service{gateway: gateway}
}

// Startup wires the Wails runtime context into the service. It is a package
// function (not a method) so that Wails does not expose it to the frontend as
// a bound RPC.
func Startup(s *Service, ctx context.Context) {
	s.ctx = ctx
}

func (s *Service) StartMockChat(request llm.ChatRequest) error {
	if s.ctx == nil {
		return errors.New("application is not ready")
	}
	stream, err := s.gateway.Complete(s.ctx, request)
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
