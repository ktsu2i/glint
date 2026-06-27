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

// httpClientForListing は listing API 呼び出し専用の short-timeout client。
// streaming endpoint と違って待ち時間は最小で良い。
func httpClientForListing() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 15 * time.Second
	return &http.Client{
		Timeout:   20 * time.Second,
		Transport: transport,
	}
}

// listingBaseURL は cfg.Options["base_url"] の上書きを尊重して listing endpoint
// を組み立てる helper。fallback には provider 公式 endpoint を渡す。
func listingBaseURL(cfg ProviderConfig, fallback string) string {
	base := strings.TrimSpace(optionString(cfg.Options, "base_url", ""))
	if base == "" {
		return fallback
	}
	return strings.TrimRight(base, "/")
}

// fetchJSON は listing API への共通 GET 呼び出し。auth header やクエリは
// provider 側で組み立て済みのものを渡す。
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

// anthropicModelLister は Anthropic の `/v1/models` を叩く。
func anthropicModelLister(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error) {
	if strings.TrimSpace(deps.APIKey) == "" {
		return nil, fmt.Errorf("anthropic API key is required for model listing")
	}
	base := listingBaseURL(cfg, "https://api.anthropic.com")
	endpoint := base + "/v1/models?limit=1000"
	version := strings.TrimSpace(optionString(cfg.Options, "anthropic_version", AnthropicDefaultVersion))
	if version == "" {
		version = AnthropicDefaultVersion
	}
	headers := map[string]string{
		"x-api-key":         deps.APIKey,
		"anthropic-version": version,
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

// openAIModelLister は OpenAI の `/v1/models` を叩く。
func openAIModelLister(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error) {
	if strings.TrimSpace(deps.APIKey) == "" {
		return nil, fmt.Errorf("openai API key is required for model listing")
	}
	base := listingBaseURL(cfg, "https://api.openai.com/v1")
	endpoint := base + "/models"
	// OpenAI base_url は `chat/completions` までを含めて入力されることがある。
	// listing endpoint だけ別 path なので、`/chat/completions` 部を落とす。
	if trimmed, ok := strings.CutSuffix(base, "/chat/completions"); ok {
		endpoint = trimmed + "/models"
	}
	headers := map[string]string{
		"Authorization": "Bearer " + deps.APIKey,
	}
	if org := strings.TrimSpace(optionString(cfg.Options, "organization", "")); org != "" {
		headers["OpenAI-Organization"] = org
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

// openRouterLister は OpenRouter の `/api/v1/models` を叩く。
// OpenRouter は API key 不要でも一覧を返すが、念のため key があれば付ける。
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

// ollamaModelLister は Ollama の `/api/tags` を叩く。
// Ollama は `/v1/chat/completions` を提供する一方で、tags endpoint は
// `/api/tags`（OpenAI 互換 namespace 外）にある点に注意。
func ollamaModelLister(ctx context.Context, cfg ProviderConfig, deps Deps) ([]ModelDescriptor, error) {
	_ = deps
	base := strings.TrimSpace(optionString(cfg.Options, "base_url", OllamaDefaultBaseURL))
	if base == "" {
		base = OllamaDefaultBaseURL
	}
	// 入力が `/v1` を含んでいる場合（OpenAI 互換 namespace）はその上の root に上る。
	root := strings.TrimRight(base, "/")
	if trimmed, ok := strings.CutSuffix(root, "/v1"); ok {
		root = trimmed
	}
	parsed, err := url.Parse(root + "/api/tags")
	if err != nil {
		return nil, fmt.Errorf("invalid Ollama base URL: %w", err)
	}
	var payload struct {
		Models []struct {
			Name  string `json:"name"`
			Model string `json:"model"`
		} `json:"models"`
	}
	if err := fetchJSON(ctx, httpClientForListing(), parsed.String(), nil, &payload); err != nil {
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
