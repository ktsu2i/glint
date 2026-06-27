package llm

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuiltInModelListingsIgnoreLegacyOptions(t *testing.T) {
	legacy := map[string]any{
		"base_url":          "https://legacy.example.com",
		"organization":      "org_legacy",
		"anthropic_version": "2099-01-01",
	}

	anthropicEndpoint, anthropicHeaders, err := anthropicModelListingRequest(
		ProviderConfig{ProviderID: ProviderAnthropic, Options: legacy},
		Deps{APIKey: "anthropic-key"},
	)
	require.NoError(t, err)
	assert.Equal(t, AnthropicDefaultBaseURL+"/v1/models?limit=1000", anthropicEndpoint)
	assert.Equal(t, AnthropicDefaultVersion, anthropicHeaders["anthropic-version"])

	openAIEndpoint, openAIHeaders, err := openAIModelListingRequest(
		ProviderConfig{ProviderID: ProviderOpenAI, Options: legacy},
		Deps{APIKey: "openai-key"},
	)
	require.NoError(t, err)
	assert.Equal(t, OpenAIDefaultBaseURL+"/models", openAIEndpoint)
	assert.Empty(t, openAIHeaders["OpenAI-Organization"])

	ollamaEndpoint, err := ollamaModelListingEndpoint(ProviderConfig{
		ProviderID: ProviderOllama,
		Options: map[string]any{
			"base_url": "http://legacy.example.com/v1",
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "http://localhost:11434/api/tags", ollamaEndpoint)
}
