package assetserver

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
)

const (
	BookRoutePrefix  = "/book/"
	CoverRoutePrefix = "/cover/"
)

type localResource struct {
	path        string
	contentType string
}

type Server struct {
	mu        sync.RWMutex
	resources map[string]localResource
	paths     map[localResource]string
}

func New() *Server {
	return &Server{
		resources: make(map[string]localResource),
		paths:     make(map[localResource]string),
	}
}

func (s *Server) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, BookRoutePrefix) ||
			strings.HasPrefix(request.URL.Path, CoverRoutePrefix) {
			s.ServeHTTP(response, request)
			return
		}
		next.ServeHTTP(response, request)
	})
}

func (s *Server) Register(path, contentType string) (string, error) {
	resource := localResource{path: path, contentType: contentType}
	s.mu.Lock()
	defer s.mu.Unlock()
	if token, ok := s.paths[resource]; ok {
		return routeFor(contentType, token), nil
	}
	token, err := randomToken()
	if err != nil {
		return "", fmt.Errorf("create local file token: %w", err)
	}
	s.resources[token] = resource
	s.paths[resource] = token
	return routeFor(contentType, token), nil
}

func routeFor(contentType, token string) string {
	if contentType == "application/pdf" {
		return BookRoutePrefix + token
	}
	return CoverRoutePrefix + token
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := strings.TrimPrefix(request.URL.Path, BookRoutePrefix)
	if token == request.URL.Path {
		token = strings.TrimPrefix(request.URL.Path, CoverRoutePrefix)
	}
	if token == "" || token == request.URL.Path || strings.Contains(token, "/") {
		http.NotFound(response, request)
		return
	}
	s.mu.RLock()
	resource, ok := s.resources[token]
	s.mu.RUnlock()
	if !ok {
		http.NotFound(response, request)
		return
	}
	file, err := os.Open(resource.path)
	if err != nil {
		http.Error(response, "local file is no longer available", http.StatusGone)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.Error(response, "unable to inspect local file", http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", resource.contentType)
	if resource.contentType == "application/pdf" {
		response.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", info.Name()))
		response.Header().Set("Cache-Control", "no-store")
	} else {
		response.Header().Set("Cache-Control", "private, max-age=3600")
	}
	http.ServeContent(response, request, info.Name(), info.ModTime(), file)
}

func randomToken() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
