package llm

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBuiltinModelsExposesProviderSeeds(t *testing.T) {
	for _, provider := range []ProviderID{ProviderAnthropic, ProviderOpenAI, ProviderGoogle, ProviderOpenRouter} {
		models := BuiltinModels(provider)
		assert.NotEmpty(t, models, "builtin catalog must seed %s", provider)
		for _, model := range models {
			assert.Equal(t, ModelSourceBuiltin, model.Source)
			assert.NotEmpty(t, model.ID)
		}
	}
	// Ollama and openai_compatible intentionally have no builtin seed list.
	assert.Empty(t, BuiltinModels(ProviderOllama))
	assert.Empty(t, BuiltinModels(ProviderID("openai_compatible:foo")))
}

func TestMergeModelsKeepsPrimaryAndAppendsUniqueSecondary(t *testing.T) {
	primary := []ModelDescriptor{
		{ID: "alpha", Source: ModelSourceAPI},
		{ID: "beta", Source: ModelSourceAPI},
	}
	secondary := []ModelDescriptor{
		{ID: "beta", Source: ModelSourceBuiltin}, // duplicate; should be dropped
		{ID: "gamma", Source: ModelSourceBuiltin},
	}
	merged := MergeModels(primary, secondary)

	require := []ModelDescriptor{
		{ID: "alpha", Source: ModelSourceAPI},
		{ID: "beta", Source: ModelSourceAPI},
		{ID: "gamma", Source: ModelSourceBuiltin},
	}
	assert.Equal(t, require, merged)
}

func TestMergeModelsSkipsEmptyIDs(t *testing.T) {
	merged := MergeModels([]ModelDescriptor{{ID: ""}}, []ModelDescriptor{{ID: "real"}})
	assert.Equal(t, []ModelDescriptor{{ID: "real"}}, merged)
}

func TestSortModelsOrdersByID(t *testing.T) {
	models := []ModelDescriptor{{ID: "gamma"}, {ID: "alpha"}, {ID: "beta"}}
	SortModels(models)
	assert.Equal(t, "alpha", models[0].ID)
	assert.Equal(t, "beta", models[1].ID)
	assert.Equal(t, "gamma", models[2].ID)
}
