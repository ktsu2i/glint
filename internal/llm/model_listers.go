package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func httpClientForListing() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 15 * time.Second
	return &http.Client{
		Timeout:   20 * time.Second,
		Transport: transport,
	}
}

func fetchJSON(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create listing request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("listing request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4*1024))
		return fmt.Errorf("listing request failed (%d): %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(out)
}

func anthropicModelLister(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error) {
	endpoint, headers, err := anthropicModelListingRequest(cfg, deps)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Data []struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"data"`
	}
	if err := fetchJSON(ctx, httpClientForListing(), endpoint, headers, &payload); err != nil {
		return nil, err
	}
	models := make([]ModelDescriptor, 0, len(payload.Data))
	for _, entry := range payload.Data {
		id := strings.TrimSpace(entry.ID)
		if id == "" {
			continue
		}
		models = append(models, ModelDescriptor{
			ID:          id,
			DisplayName: strings.TrimSpace(entry.DisplayName),
			Source:      ModelSourceAPI,
		})
	}
	return models, nil
}

func openAIModelLister(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error) {
	endpoint, headers, err := openAIModelListingRequest(cfg, deps)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := fetchJSON(ctx, httpClientForListing(), endpoint, headers, &payload); err != nil {
		return nil, err
	}
	models := make([]ModelDescriptor, 0, len(payload.Data))
	for _, entry := range payload.Data {
		id := strings.TrimSpace(entry.ID)
		if id == "" {
			continue
		}
		models = append(models, ModelDescriptor{
			ID:     id,
			Source: ModelSourceAPI,
		})
	}
	return models, nil
}

func openRouterLister(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error) {
	_ = cfg
	endpoint := "https://openrouter.ai/api/v1/models"
	headers := map[string]string{}
	if key := strings.TrimSpace(deps.APIKey); key != "" {
		headers["Authorization"] = "Bearer " + key
	}
	var payload struct {
		Data []struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			ContextLength int    `json:"context_length"`
		} `json:"data"`
	}
	if err := fetchJSON(ctx, httpClientForListing(), endpoint, headers, &payload); err != nil {
		return nil, err
	}
	models := make([]ModelDescriptor, 0, len(payload.Data))
	for _, entry := range payload.Data {
		id := strings.TrimSpace(entry.ID)
		if id == "" {
			continue
		}
		models = append(models, ModelDescriptor{
			ID:            id,
			DisplayName:   strings.TrimSpace(entry.Name),
			ContextWindow: entry.ContextLength,
			Source:        ModelSourceAPI,
		})
	}
	return models, nil
}

func ollamaModelLister(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error) {
	_ = deps
	endpoint, err := ollamaModelListingEndpoint(cfg)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Models []struct {
			Name  string `json:"name"`
			Model string `json:"model"`
		} `json:"models"`
	}
	if err := fetchJSON(ctx, httpClientForListing(), endpoint, nil, &payload); err != nil {
		return nil, err
	}
	models := make([]ModelDescriptor, 0, len(payload.Models))
	for _, entry := range payload.Models {
		id := strings.TrimSpace(entry.Name)
		if id == "" {
			id = strings.TrimSpace(entry.Model)
		}
		if id == "" {
			continue
		}
		models = append(models, ModelDescriptor{
			ID:     id,
			Source: ModelSourceAPI,
		})
	}
	return models, nil
}

func anthropicModelListingRequest(cfg ProviderConfig, deps Deps) (string, map[string]string, error) {
	_ = cfg
	if strings.TrimSpace(deps.APIKey) == "" {
		return "", nil, fmt.Errorf("anthropic API key is required for model listing")
	}
	return AnthropicDefaultBaseURL + "/v1/models?limit=1000", map[string]string{
		"x-api-key":         deps.APIKey,
		"anthropic-version": AnthropicDefaultVersion,
	}, nil
}

func openAIModelListingRequest(cfg ProviderConfig, deps Deps) (string, map[string]string, error) {
	_ = cfg
	if strings.TrimSpace(deps.APIKey) == "" {
		return "", nil, fmt.Errorf("openai API key is required for model listing")
	}
	return OpenAIDefaultBaseURL + "/models", map[string]string{
		"Authorization": "Bearer " + deps.APIKey,
	}, nil
}

func ollamaModelListingEndpoint(cfg ProviderConfig) (string, error) {
	_ = cfg
	root := strings.TrimRight(OllamaDefaultBaseURL, "/")
	if trimmed, ok := strings.CutSuffix(root, "/v1"); ok {
		root = trimmed
	}
	parsed, err := url.Parse(root + "/api/tags")
	if err != nil {
		return "", fmt.Errorf("invalid Ollama base URL: %w", err)
	}
	return parsed.String(), nil
}
