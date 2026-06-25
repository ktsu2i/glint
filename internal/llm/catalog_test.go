package llm

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegistryDescribesBuiltins(t *testing.T) {
	registry := NewRegistry()
	descriptors := registry.Descriptors()
	ids := make([]ProviderID, 0, len(descriptors))
	for _, descriptor := range descriptors {
		ids = append(ids, descriptor.ID)
	}
	assert.ElementsMatch(t, []ProviderID{ProviderAnthropic, ProviderGoogle, ProviderOllama, ProviderOpenAI, ProviderOpenAICompatible, ProviderOpenRouter}, ids)

	descriptor, ok := registry.Descriptor(ProviderOpenRouter)
	require.True(t, ok)
	require.NotEmpty(t, descriptor.OptionSchema)
	assert.Equal(t, "zdr", descriptor.OptionSchema[0].Key)
	assert.True(t, descriptor.RequiresAPIKey())

	ollama, ok := registry.Descriptor(ProviderOllama)
	require.True(t, ok)
	assert.False(t, ollama.RequiresAPIKey())
	assert.Equal(t, OllamaDefaultBaseURL, ollama.DefaultBaseURL)

	openAI, ok := registry.Descriptor(ProviderOpenAI)
	require.True(t, ok)
	assert.True(t, openAI.RequiresAPIKey())
	assert.Equal(t, OpenAIDefaultEndpoint, openAI.DefaultBaseURL)
}

func TestRegistryResolvesOpenAICompatibleSlugToTemplate(t *testing.T) {
	registry := NewRegistry()
	descriptor, ok := registry.Descriptor(ProviderID("openai_compatible:groq"))
	require.True(t, ok)
	assert.Equal(t, ProviderOpenAICompatible, descriptor.ID)
}

func TestRegistryValidatesOpenRouterModel(t *testing.T) {
	registry := NewRegistry()
	assert.ErrorContains(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderOpenRouter}),
		"model",
	)
	assert.ErrorContains(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderOpenRouter, Model: "invalid"}),
		"provider/model",
	)
	assert.NoError(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderOpenRouter, Model: "provider/model"}),
	)
}

func TestRegistryBuildDispatchesToOpenRouterFactory(t *testing.T) {
	registry := NewRegistry()
	gateway, err := registry.Build(
		ProviderConfig{
			ProviderID: ProviderOpenRouter,
			Model:      "provider/model",
			Options:    map[string]any{"zdr": false},
		},
		Deps{APIKey: "secret"},
	)
	require.NoError(t, err)
	openRouter, ok := gateway.(*OpenRouterGateway)
	require.True(t, ok)
	assert.False(t, openRouter.zdr)
	assert.Equal(t, "provider/model", openRouter.model)
}

func TestRegistryRejectsUnknownProvider(t *testing.T) {
	registry := NewRegistry()
	_, err := registry.Build(ProviderConfig{ProviderID: "no-such-provider", Model: "x"}, Deps{})
	assert.ErrorContains(t, err, "unknown")
}

func TestRegistryBuildDispatchesToOpenAIFactory(t *testing.T) {
	registry := NewRegistry()
	gateway, err := registry.Build(
		ProviderConfig{
			ProviderID: ProviderOpenAI,
			Model:      "gpt-5",
			Options:    map[string]any{"organization": "org_abc"},
		},
		Deps{APIKey: "secret"},
	)
	require.NoError(t, err)
	openAI, ok := gateway.(*OpenAIGateway)
	require.True(t, ok)
	assert.Equal(t, "gpt-5", openAI.model)
}

func TestRegistryBuildDispatchesToAnthropicFactory(t *testing.T) {
	registry := NewRegistry()
	gateway, err := registry.Build(
		ProviderConfig{
			ProviderID: ProviderAnthropic,
			Model:      "claude-opus-4-7",
			Options:    map[string]any{"anthropic_version": "2024-10-22"},
		},
		Deps{APIKey: "secret"},
	)
	require.NoError(t, err)
	anthropic, ok := gateway.(*AnthropicGateway)
	require.True(t, ok)
	assert.Equal(t, "claude-opus-4-7", anthropic.model)
	assert.Equal(t, "2024-10-22", anthropic.anthropicVersion)
}

func TestRegistryValidatesAnthropicModel(t *testing.T) {
	registry := NewRegistry()
	assert.ErrorContains(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderAnthropic}),
		"model",
	)
	assert.NoError(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderAnthropic, Model: "claude-opus-4-7"}),
	)
}

func TestAnthropicDescriptorExposesXApiKeyAuth(t *testing.T) {
	registry := NewRegistry()
	descriptor, ok := registry.Descriptor(ProviderAnthropic)
	require.True(t, ok)
	assert.Equal(t, AuthKindXApiKey, descriptor.AuthKind)
	assert.True(t, descriptor.RequiresAPIKey())
	assert.Equal(t, AnthropicDefaultEndpoint, descriptor.DefaultBaseURL)
}

func TestRegistryBuildDispatchesToGoogleFactory(t *testing.T) {
	registry := NewRegistry()
	gateway, err := registry.Build(
		ProviderConfig{
			ProviderID: ProviderGoogle,
			Model:      "gemini-2.5-pro",
			Options:    map[string]any{"auth_mode": GoogleAuthModeQuery},
		},
		Deps{APIKey: "secret"},
	)
	require.NoError(t, err)
	google, ok := gateway.(*GoogleGateway)
	require.True(t, ok)
	assert.Equal(t, "gemini-2.5-pro", google.model)
	assert.Equal(t, GoogleAuthModeQuery, google.authMode)
}

func TestRegistryValidatesGoogleModel(t *testing.T) {
	registry := NewRegistry()
	assert.ErrorContains(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderGoogle}),
		"model",
	)
	assert.ErrorContains(t,
		registry.Validate(ProviderConfig{
			ProviderID: ProviderGoogle,
			Model:      "gemini-pro",
			Options:    map[string]any{"auth_mode": "bogus"},
		}),
		"auth_mode",
	)
	assert.NoError(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderGoogle, Model: "gemini-pro"}),
	)
}

func TestGoogleDescriptorExposesXApiKeyAuth(t *testing.T) {
	registry := NewRegistry()
	descriptor, ok := registry.Descriptor(ProviderGoogle)
	require.True(t, ok)
	assert.Equal(t, AuthKindXApiKey, descriptor.AuthKind)
	assert.True(t, descriptor.RequiresAPIKey())
	assert.Equal(t, GoogleDefaultBaseURL, descriptor.DefaultBaseURL)
}

func TestRegistryBuildDispatchesToOllamaFactory(t *testing.T) {
	registry := NewRegistry()
	gateway, err := registry.Build(
		ProviderConfig{
			ProviderID: ProviderOllama,
			Model:      "llama3",
		},
		Deps{},
	)
	require.NoError(t, err)
	ollama, ok := gateway.(*OllamaGateway)
	require.True(t, ok)
	assert.Equal(t, "llama3", ollama.model)
}

func TestRegistryBuildDispatchesToOpenAICompatibleFactory(t *testing.T) {
	registry := NewRegistry()
	gateway, err := registry.Build(
		ProviderConfig{
			ProviderID:   ProviderID("openai_compatible:groq"),
			DisplayLabel: "Groq",
			Model:        "llama-3.3-70b-versatile",
			Options: map[string]any{
				"base_url":         "https://api.groq.com/openai/v1",
				"requires_api_key": true,
			},
		},
		Deps{APIKey: "secret"},
	)
	require.NoError(t, err)
	compat, ok := gateway.(*OpenAICompatibleGateway)
	require.True(t, ok)
	assert.Equal(t, "llama-3.3-70b-versatile", compat.model)
}

func TestRegistryValidatesOpenAICompatibleRequiresSlug(t *testing.T) {
	registry := NewRegistry()
	err := registry.Validate(ProviderConfig{
		ProviderID: ProviderOpenAICompatible,
		Model:      "x",
		Options:    map[string]any{"base_url": "https://example.com/v1"},
	})
	assert.ErrorContains(t, err, "openai_compatible:")
}

func TestRegistryValidatesOpenAICompatibleRequiresBaseURL(t *testing.T) {
	registry := NewRegistry()
	err := registry.Validate(ProviderConfig{
		ProviderID: ProviderID("openai_compatible:groq"),
		Model:      "model",
	})
	assert.ErrorContains(t, err, "base URL")
}

func TestOptionBoolFallback(t *testing.T) {
	assert.True(t, optionBool(nil, "zdr", true))
	assert.False(t, optionBool(map[string]any{"zdr": false}, "zdr", true))
	assert.True(t, optionBool(map[string]any{"zdr": "true"}, "zdr", false))
	assert.False(t, optionBool(map[string]any{"zdr": "no"}, "zdr", true))
	assert.True(t, optionBool(map[string]any{"other": "x"}, "zdr", true))
}
