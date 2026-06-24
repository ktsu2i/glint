package llm

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegistryDescribesOpenRouter(t *testing.T) {
	registry := NewRegistry()
	descriptors := registry.Descriptors()
	require.Len(t, descriptors, 1)
	assert.Equal(t, ProviderOpenRouter, descriptors[0].ID)
	assert.Equal(t, AuthKindBearer, descriptors[0].AuthKind)

	descriptor, ok := registry.Descriptor(ProviderOpenRouter)
	require.True(t, ok)
	require.NotEmpty(t, descriptor.OptionSchema)
	assert.Equal(t, "zdr", descriptor.OptionSchema[0].Key)
	assert.True(t, descriptor.RequiresAPIKey())
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

func TestOptionBoolFallback(t *testing.T) {
	assert.True(t, optionBool(nil, "zdr", true))
	assert.False(t, optionBool(map[string]any{"zdr": false}, "zdr", true))
	assert.True(t, optionBool(map[string]any{"zdr": "true"}, "zdr", false))
	assert.False(t, optionBool(map[string]any{"zdr": "no"}, "zdr", true))
	assert.True(t, optionBool(map[string]any{"other": "x"}, "zdr", true))
}
