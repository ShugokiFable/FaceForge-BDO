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

func encodedFixture(t *testing.T, name string) string {
	t.Helper()
	return base64.StdEncoding.EncodeToString(appFixture(t, name))
}

// testHandler builds a handler with a throwaway slider map, so calibration in one
// test never leaks into another.
func testHandler(t *testing.T) http.Handler {
	t.Helper()
	return NewHandler(Config{
		Token:            "secret",
		CustomizationDir: t.TempDir(),
		SliderMapPath:    filepath.Join(t.TempDir(), "slidermap.json"),
	})
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

func decodeBody(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode body %q: %v", response.Body.String(), err)
	}
	return payload
}

func TestAPIRejectsMissingToken(t *testing.T) {
	response := request(t, testHandler(t), http.MethodGet, "/api/status", "", nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", response.Code, response.Body.String())
	}
}

func TestStatusAdvertisesControlsAndCalibrations(t *testing.T) {
	response := request(t, testHandler(t), http.MethodGet, "/api/status", "secret", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	payload := decodeBody(t, response)
	if payload["name"] != ProductName || payload["version"] != Version {
		t.Fatalf("unexpected identity in status: %+v", payload)
	}
	controls, ok := payload["controls"].([]any)
	if !ok || len(controls) != len(preset.Controls) {
		t.Fatalf("controls = %v, want %d entries", payload["controls"], len(preset.Controls))
	}
	// A fresh install must report zero calibrations rather than implying the
	// photo matching already works.
	if calibrations, _ := payload["calibrations"].([]any); len(calibrations) != 0 {
		t.Fatalf("a fresh slider map reported %d calibrations", len(calibrations))
	}
}

// The full path the user takes: learn one slider, then generate from a photo.
func TestLearnThenGenerate(t *testing.T) {
	handler := testHandler(t)

	base, err := preset.Parse(appFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	// Stand in for a save made after dragging one slider to maximum.
	plain := base.Edit()
	target := -1
	for offset := preset.SliderFirst; offset <= preset.SliderLast; offset++ {
		if !preset.IsSlider(offset) {
			continue
		}
		if plain[offset] < 50 {
			target = offset
			break
		}
	}
	if target < 0 {
		t.Fatal("no slider below 50 in the fixture")
	}
	plain[target] = 100
	maxed, err := preset.FromPlain(plain)
	if err != nil {
		t.Fatal(err)
	}

	learn := request(t, handler, http.MethodPost, "/api/learn", "secret", map[string]any{
		"controlId": "nose_width",
		"base":      encodedFixture(t, "Cute Lahn"),
		"baseName":  "base",
		"maxed":     base64.StdEncoding.EncodeToString(maxed.Bytes()),
		"maxedName": "nose maxed",
		"commit":    true,
	})
	if learn.Code != http.StatusOK {
		t.Fatalf("learn status = %d; body=%s", learn.Code, learn.Body.String())
	}
	calibration, _ := decodeBody(t, learn)["calibration"].(map[string]any)
	if got := int(calibration["offset"].(float64)); got != target {
		t.Fatalf("learned offset %d, want %d", got, target)
	}

	// The calibration must be live for the very next request.
	status := decodeBody(t, request(t, handler, http.MethodGet, "/api/status", "secret", nil))
	if calibrations, _ := status["calibrations"].([]any); len(calibrations) != 1 {
		t.Fatalf("status reports %d calibrations after learning one", len(calibrations))
	}

	generate := request(t, handler, http.MethodPost, "/api/generate", "secret", map[string]any{
		"base":         encodedFixture(t, "Cute Lahn"),
		"measurements": map[string]float64{"noseWidth": 1},
		"strength":     1,
		"name":         "Nakamoora",
	})
	if generate.Code != http.StatusOK {
		t.Fatalf("generate status = %d; body=%s", generate.Code, generate.Body.String())
	}
	payload := decodeBody(t, generate)
	if payload["characterName"] != "Nakamoora" {
		t.Fatalf("characterName = %v, want Nakamoora", payload["characterName"])
	}
	if applied, _ := payload["applied"].([]any); len(applied) != 1 {
		t.Fatalf("applied = %d controls, want 1", len(applied))
	}
	built, err := base64.StdEncoding.DecodeString(payload["data"].(string))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := preset.Parse(built)
	if err != nil {
		t.Fatalf("the API returned a preset that does not parse: %v", err)
	}
	if got, _ := parsed.Slider(target); got != 100 {
		t.Fatalf("generated slider %d = %d, want 100", target, got)
	}
	if got, want := parsed.Class(), base.Class(); got != want {
		t.Fatalf("generate changed the class to %d, want %d", got, want)
	}
}

func TestGenerateWithoutCalibrationIsRejected(t *testing.T) {
	response := request(t, testHandler(t), http.MethodPost, "/api/generate", "secret", map[string]any{
		"base":         encodedFixture(t, "Cute Lahn"),
		"measurements": map[string]float64{"noseWidth": 1},
		"strength":     1,
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", response.Code, response.Body.String())
	}
}

// An ambiguous diff must surface the candidates instead of committing a guess.
func TestLearnAmbiguousDiffReportsCandidates(t *testing.T) {
	handler := testHandler(t)
	base, err := preset.Parse(appFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	plain := base.Edit()
	changed := 0
	for offset := preset.SliderFirst; offset <= preset.SliderLast && changed < 2; offset++ {
		if !preset.IsSlider(offset) || plain[offset] >= 50 {
			continue
		}
		plain[offset] = 100
		changed++
	}
	maxed, err := preset.FromPlain(plain)
	if err != nil {
		t.Fatal(err)
	}
	response := request(t, handler, http.MethodPost, "/api/learn", "secret", map[string]any{
		"controlId": "nose_width",
		"base":      encodedFixture(t, "Cute Lahn"),
		"maxed":     base64.StdEncoding.EncodeToString(maxed.Bytes()),
		"commit":    true,
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", response.Code, response.Body.String())
	}
	if changes, _ := decodeBody(t, response)["changes"].([]any); len(changes) != 2 {
		t.Fatalf("changes = %d, want the 2 candidates reported back", len(changes))
	}
	// Nothing may have been persisted.
	status := decodeBody(t, request(t, handler, http.MethodGet, "/api/status", "secret", nil))
	if calibrations, _ := status["calibrations"].([]any); len(calibrations) != 0 {
		t.Fatal("an ambiguous learn was committed anyway")
	}
}

func TestBlendRejectsCrossClass(t *testing.T) {
	response := request(t, testHandler(t), http.MethodPost, "/api/blend", "secret", map[string]any{
		"base":   encodedFixture(t, "Cute Lahn"),
		"donor":  encodedFixture(t, "Mommy Guardian"),
		"weight": 0.5,
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", response.Code, response.Body.String())
	}
}

func TestSaveWritesValidatedPresetAndBacksUp(t *testing.T) {
	directory := t.TempDir()
	handler := NewHandler(Config{
		Token:            "secret",
		CustomizationDir: directory,
		SliderMapPath:    filepath.Join(t.TempDir(), "slidermap.json"),
	})
	body := map[string]any{"filename": "Test Face", "data": encodedFixture(t, "Cute Lahn")}

	first := request(t, handler, http.MethodPost, "/api/save", "secret", body)
	if first.Code != http.StatusOK {
		t.Fatalf("first save = %d; body=%s", first.Code, first.Body.String())
	}
	written, err := os.ReadFile(filepath.Join(directory, "Test Face"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(written, appFixture(t, "Cute Lahn")) {
		t.Fatal("saved file does not match the bytes supplied")
	}

	second := request(t, handler, http.MethodPost, "/api/save", "secret", body)
	if second.Code != http.StatusOK {
		t.Fatalf("second save = %d; body=%s", second.Code, second.Body.String())
	}
	if backup, _ := decodeBody(t, second)["backupPath"].(string); backup == "" {
		t.Fatal("overwriting an existing preset did not produce a backup")
	}
}

func TestSaveRejectsCorruptData(t *testing.T) {
	response := request(t, testHandler(t), http.MethodPost, "/api/save", "secret", map[string]any{
		"filename": "Broken",
		"data":     base64.StdEncoding.EncodeToString([]byte("not a preset")),
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", response.Code, response.Body.String())
	}
}

func TestSaveRejectsPathTraversal(t *testing.T) {
	response := request(t, testHandler(t), http.MethodPost, "/api/save", "secret", map[string]any{
		"filename": filepath.Join("..", "escaped"),
		"data":     encodedFixture(t, "Cute Lahn"),
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", response.Code, response.Body.String())
	}
}
