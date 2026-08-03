package app

import (
	"crypto/subtle"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"

	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
)

const (
	ProductName = "FaceForge BDO"
	Version     = "0.4.0"
	TokenHeader = "X-FaceForge-Token"
	maxBodySize = 8 << 20
)

type Config struct {
	Token            string
	Schema           preset.Schema
	CustomizationDir string
	StaticFS         fs.FS
	Shutdown         func()
}

type server struct {
	config Config
	mux    *http.ServeMux
}

func NewHandler(config Config) http.Handler {
	application := &server{config: config, mux: http.NewServeMux()}
	application.routes()
	return securityHeaders(application.mux)
}

func (s *server) authenticated(next http.HandlerFunc) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		supplied := request.Header.Get(TokenHeader)
		expected := s.config.Token
		if expected == "" || len(supplied) != len(expected) || subtle.ConstantTimeCompare([]byte(supplied), []byte(expected)) != 1 {
			writeError(writer, http.StatusUnauthorized, "The local app token is missing or invalid. Relaunch FaceForge BDO from the EXE.")
			return
		}
		next(writer, request)
	}
}

func requireMethod(method string, next http.HandlerFunc) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != method {
			writer.Header().Set("Allow", method)
			writeError(writer, http.StatusMethodNotAllowed, "Method not allowed.")
			return
		}
		next(writer, request)
	}
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, destination any) bool {
	request.Body = http.MaxBytesReader(writer, request.Body, maxBodySize)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(writer, http.StatusBadRequest, "Invalid request: "+err.Error())
		return false
	}
	return true
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]any{"error": strings.TrimSpace(message), "status": status})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("Referrer-Policy", "no-referrer")
		writer.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		writer.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		writer.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(writer, request)
	})
}
