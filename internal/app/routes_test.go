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
	if payload["name"] != "FaceForge BDO" || payload["version"] != "0.5.2" {
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

func TestBlendEndpointSerializesNoChangesAsEmptyArray(t *testing.T) {
	handler := NewHandler(Config{Token: "secret", Schema: appSchema(t), CustomizationDir: t.TempDir()})
	data := base64.StdEncoding.EncodeToString(appFixture(t, "Cute Lahn"))
	response := request(t, handler, http.MethodPost, "/api/blend", "secret", map[string]any{
		"base": data,
		"donors": map[string]string{
			"base-profile": data,
		},
		"recipe": map[string]any{
			"seed": "same-preset-test",
			"groups": []map[string]any{
				{"groupId": "face_geometry", "donorId": "base-profile", "weight": 100},
				{"groupId": "eyes_brows", "donorId": "base-profile", "weight": 100},
			},
		},
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if string(payload["changedBlocks"]) != "[]" {
		t.Fatalf("changedBlocks JSON = %s, want []", payload["changedBlocks"])
	}
}

func TestAPIRejectsWrongMethod(t *testing.T) {
	handler := NewHandler(Config{Token: "secret", Schema: appSchema(t), CustomizationDir: t.TempDir()})
	response := request(t, handler, http.MethodGet, "/api/inspect", "secret", nil)
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", response.Code)
	}
}

func TestReferenceCatalogAPIStoresProfilesOnDisk(t *testing.T) {
	catalogPath := filepath.Join(t.TempDir(), "reference-catalog.json")
	handler := NewHandler(Config{
		Token:                "secret",
		Schema:               appSchema(t),
		CustomizationDir:     t.TempDir(),
		ReferenceCatalogPath: catalogPath,
	})
	payload := map[string]any{
		"version": 1,
		"profiles": map[string]any{
			"ABCDEF": map[string]any{
				"sha256":           "ABCDEF",
				"name":             "Striker Reference",
				"classFingerprint": "class-one",
				"imageName":        "striker.png",
				"metrics":          map[string]float64{"jawWidth": 0.62},
				"quality":          map[string]float64{"symmetry": 0.91},
			},
		},
	}
	response := request(t, handler, http.MethodPost, "/api/reference-catalog", "secret", payload)
	if response.Code != http.StatusOK {
		t.Fatalf("save status = %d; body=%s", response.Code, response.Body.String())
	}
	response = request(t, handler, http.MethodGet, "/api/reference-catalog", "secret", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("load status = %d; body=%s", response.Code, response.Body.String())
	}
	var loaded struct {
		Profiles map[string]struct {
			SHA256 string `json:"sha256"`
			Name   string `json:"name"`
		} `json:"profiles"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &loaded); err != nil {
		t.Fatal(err)
	}
	profile, ok := loaded.Profiles["abcdef"]
	if !ok || profile.SHA256 != "abcdef" || profile.Name != "Striker Reference" {
		t.Fatalf("unexpected catalog response: %+v", loaded.Profiles)
	}
}
