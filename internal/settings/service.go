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

func (service *Service) GetLLMConfig() (LLMConfig, error) {
	if service.ctx == nil {
		return LLMConfig{}, errors.New("application is not ready")
	}
	return service.manager.GetLLMConfig(service.ctx)
}

func (service *Service) UpsertProviderSettings(request UpsertProviderRequest) (LLMConfig, error) {
	if service.ctx == nil {
		return LLMConfig{}, errors.New("application is not ready")
	}
	return service.manager.UpsertProviderSettings(service.ctx, request)
}

func (service *Service) DeleteProviderSettings(providerID string) (LLMConfig, error) {
	if service.ctx == nil {
		return LLMConfig{}, errors.New("application is not ready")
	}
	return service.manager.DeleteProviderSettings(service.ctx, providerID)
}

func (service *Service) SetActiveProvider(providerID string) (LLMConfig, error) {
	if service.ctx == nil {
		return LLMConfig{}, errors.New("application is not ready")
	}
	return service.manager.SetActiveProvider(service.ctx, providerID)
}

func (service *Service) GetAppearanceSettings() (AppearanceSettings, error) {
	if service.ctx == nil {
		return AppearanceSettings{}, errors.New("application is not ready")
	}
	return service.manager.GetAppearance(service.ctx)
}

func (service *Service) SaveAppearanceSettings(request SaveAppearanceSettingsRequest) (AppearanceSettings, error) {
	if service.ctx == nil {
		return AppearanceSettings{}, errors.New("application is not ready")
	}
	return service.manager.SaveAppearance(service.ctx, request)
}

func (service *Service) GetLanguageSettings() (LanguageSettings, error) {
	if service.ctx == nil {
		return LanguageSettings{}, errors.New("application is not ready")
	}
	return service.manager.GetLanguage(service.ctx)
}

func (service *Service) SaveLanguageSettings(request SaveLanguageSettingsRequest) (LanguageSettings, error) {
	if service.ctx == nil {
		return LanguageSettings{}, errors.New("application is not ready")
	}
	return service.manager.SaveLanguage(service.ctx, request)
}
