package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
)

func appFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "presets", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func appSchema(t *testing.T) preset.Schema {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "assets", "schema", "version20.json"))
	if err != nil {
		t.Fatal(err)
	}
	var schema preset.Schema
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	return schema
}

func request(t *testing.T, handler http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set(TokenHeader, token)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func TestAPIRejectsMissingToken(t *testing.T) {
	handler := NewHandler(Config{Token: "secret", Schema: appSchema(t), CustomizationDir: t.TempDir()})
	response := request(t, handler, http.MethodGet, "/api/status", "", nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", response.Code, response.Body.String())
	}
}

func TestStatusReturnsVersionAndSchema(t *testing.T) {
	handler := NewHandler(Config{Token: "secret", Schema: appSchema(t), CustomizationDir: t.TempDir()})
	response := request(t, handler, http.MethodGet, "/api/status", "secret", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["name"] != "FaceForge BDO" || payload["version"] != "0.4.0" {
		t.Fatalf("unexpected status payload: %+v", payload)
	}
}

func TestInspectReturnsBlockMetadata(t *testing.T) {
	handler := NewHandler(Config{Token: "secret", Schema: appSchema(t), CustomizationDir: t.TempDir()})
	response := request(t, handler, http.MethodPost, "/api/inspect", "secret", map[string]string{
		"data": base64.StdEncoding.EncodeToString(appFixture(t, "Cute Lahn")),
		"name": "Cute Lahn",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Version          uint32 `json:"version"`
		BlockCount       int    `json:"blockCount"`
		ClassFingerprint string `json:"classFingerprint"`
		Blocks           []any  `json:"blocks"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Version != 20 || payload.BlockCount != 115 || len(payload.Blocks) != 115 {
		t.Fatalf("unexpected inspect payload: %+v", payload)
	}
	if payload.ClassFingerprint != "1095d5067c485fc5" {
		t.Fatalf("class fingerprint = %q", payload.ClassFingerprint)
	}
}

func TestBlendEndpointReturnsValidPresetAndPreservesClass(t *testing.T) {
	handler := NewHandler(Config{Token: "secret", Schema: appSchema(t), CustomizationDir: t.TempDir()})
	response := request(t, handler, http.MethodPost, "/api/blend", "secret", map[string]any{
		"base": base64.StdEncoding.EncodeToString(appFixture(t, "Cute Lahn")),
		"donors": map[string]string{
			"demure": base64.StdEncoding.EncodeToString(appFixture(t, "Demure Lahn")),
		},
		"recipe": map[string]any{
			"seed":   "api-test",
			"groups": []map[string]any{{"groupId": "face_geometry", "donorId": "demure", "weight": 50}},
		},
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(payload.Data)
	if err != nil {
		t.Fatal(err)
	}
	generated, err := preset.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	basePreset, _ := preset.Parse(appFixture(t, "Cute Lahn"))
	generatedClass, _ := generated.Block(preset.ClassBlockIndex)
	baseClass, _ := basePreset.Block(preset.ClassBlockIndex)
	if generatedClass != baseClass {
		t.Fatal("blend endpoint changed class identity")
	}
}

func TestAPIRejectsWrongMethod(t *testing.T) {
	handler := NewHandler(Config{Token: "secret", Schema: appSchema(t), CustomizationDir: t.TempDir()})
	response := request(t, handler, http.MethodGet, "/api/inspect", "secret", nil)
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", response.Code)
	}
}
