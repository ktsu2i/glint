package settings

import (
	"context"
	"errors"
)

type Service struct {
	ctx     context.Context
	manager *Manager
}

func NewService(manager *Manager) *Service {
	return &Service{manager: manager}
}

func Startup(service *Service, ctx context.Context) {
	service.ctx = ctx
}

func (service *Service) GetLLMSettings() (LLMSettings, error) {
	if service.ctx == nil {
		return LLMSettings{}, errors.New("application is not ready")
	}
	return service.manager.Get(service.ctx)
}

func (service *Service) SaveLLMSettings(request SaveLLMSettingsRequest) (LLMSettings, error) {
	if service.ctx == nil {
		return LLMSettings{}, errors.New("application is not ready")
	}
	return service.manager.Save(service.ctx, request)
}
