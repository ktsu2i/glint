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
	assert.Empty(t, descriptor.OptionSchema)
	assert.True(t, descriptor.RequiresAPIKey())

	ollama, ok := registry.Descriptor(ProviderOllama)
	require.True(t, ok)
	assert.False(t, ollama.RequiresAPIKey())
	assert.Equal(t, OllamaDefaultBaseURL, ollama.DefaultBaseURL)

	openAI, ok := registry.Descriptor(ProviderOpenAI)
	require.True(t, ok)
	assert.True(t, openAI.RequiresAPIKey())
	assert.Equal(t, OpenAIDefaultEndpoint, openAI.DefaultBaseURL)

	for _, id := range []ProviderID{ProviderOpenRouter, ProviderOpenAI, ProviderAnthropic, ProviderGoogle, ProviderOllama} {
		builtIn, found := registry.Descriptor(id)
		require.True(t, found)
		assert.Empty(t, builtIn.OptionSchema, "%s must not expose implementation options", id)
	}
	custom, ok := registry.Descriptor(ProviderOpenAICompatible)
	require.True(t, ok)
	assert.NotEmpty(t, custom.OptionSchema)
}

func TestRegistryResolvesOpenAICompatibleSlugToTemplate(t *testing.T) {
	registry := NewRegistry()
	descriptor, ok := registry.Descriptor(ProviderID("openai_compatible:groq"))
	require.True(t, ok)
	assert.Equal(t, ProviderOpenAICompatible, descriptor.ID)
}

func TestRegistryValidatesOpenRouterModel(t *testing.T) {
	registry := NewRegistry()
	assert.NoError(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderOpenRouter}),
	)
	assert.ErrorContains(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderOpenRouter, Model: "invalid"}),
		"provider/model",
	)
	assert.NoError(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderOpenRouter, Model: "provider/model"}),
	)
}

func TestRegistryBuildUsesOpenRouterZDRDefault(t *testing.T) {
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
	assert.True(t, openRouter.zdr, "legacy user option must not disable ZDR")
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
			Options: map[string]any{
				"organization": "org_abc",
				"base_url":     "https://legacy.example.com/v1",
			},
		},
		Deps{APIKey: "secret"},
	)
	require.NoError(t, err)
	openAI, ok := gateway.(*OpenAIGateway)
	require.True(t, ok)
	assert.Equal(t, "gpt-5", openAI.model)
	assert.Equal(t, OpenAIDefaultEndpoint, openAI.client.endpoint)
	assert.Empty(t, openAI.client.headers["OpenAI-Organization"])
}

func TestRegistryBuildDispatchesToAnthropicFactory(t *testing.T) {
	registry := NewRegistry()
	gateway, err := registry.Build(
		ProviderConfig{
			ProviderID: ProviderAnthropic,
			Model:      "claude-opus-4-7",
			Options: map[string]any{
				"anthropic_version": "2024-10-22",
				"base_url":          "https://legacy.example.com",
			},
		},
		Deps{APIKey: "secret"},
	)
	require.NoError(t, err)
	anthropic, ok := gateway.(*AnthropicGateway)
	require.True(t, ok)
	assert.Equal(t, "claude-opus-4-7", anthropic.model)
	assert.Equal(t, AnthropicDefaultEndpoint, anthropic.endpoint)
	assert.Equal(t, AnthropicDefaultVersion, anthropic.anthropicVersion)
}

func TestRegistryValidatesAnthropicModel(t *testing.T) {
	registry := NewRegistry()
	assert.NoError(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderAnthropic}),
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
			Options: map[string]any{
				"auth_mode":   GoogleAuthModeQuery,
				"api_version": "v1",
				"base_url":    "https://legacy.example.com",
			},
		},
		Deps{APIKey: "secret"},
	)
	require.NoError(t, err)
	google, ok := gateway.(*GoogleGateway)
	require.True(t, ok)
	assert.Equal(t, "gemini-2.5-pro", google.model)
	assert.Equal(t, GoogleAuthModeHeader, google.authMode)
	assert.Contains(t, google.endpoint, GoogleDefaultBaseURL+"/"+GoogleDefaultAPIVersion+"/models/")
	assert.NotContains(t, google.endpoint, "key=")
}

func TestRegistryValidatesGoogleModel(t *testing.T) {
	registry := NewRegistry()
	assert.NoError(t,
		registry.Validate(ProviderConfig{ProviderID: ProviderGoogle}),
	)
	assert.NoError(t, registry.Validate(ProviderConfig{
		ProviderID: ProviderGoogle,
		Model:      "gemini-pro",
		Options:    map[string]any{"auth_mode": "bogus"},
	}))
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
			Options: map[string]any{
				"base_url":   "http://legacy.example.com/v1",
				"keep_alive": "5m",
			},
		},
		Deps{},
	)
	require.NoError(t, err)
	ollama, ok := gateway.(*OllamaGateway)
	require.True(t, ok)
	assert.Equal(t, "llama3", ollama.model)
	assert.Equal(t, OllamaDefaultBaseURL+"/chat/completions", ollama.client.endpoint)
	assert.Empty(t, ollama.keepAlive)
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
		Options:    map[string]any{"base_url": "https://example.com/v1"},
	})
	assert.ErrorContains(t, err, "openai_compatible:")
}

func TestRegistryValidatesOpenAICompatibleRequiresBaseURL(t *testing.T) {
	registry := NewRegistry()
	err := registry.Validate(ProviderConfig{
		ProviderID: ProviderID("openai_compatible:groq"),
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
