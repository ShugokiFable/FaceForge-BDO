package app

import (
	"encoding/base64"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
	"github.com/ShugokiFable/FaceForge-BDO/internal/storage"
)

func (s *server) routes() {
	s.mux.HandleFunc("/api/status", s.authenticated(requireMethod(http.MethodGet, s.status)))
	s.mux.HandleFunc("/api/inspect", s.authenticated(requireMethod(http.MethodPost, s.inspect)))
	s.mux.HandleFunc("/api/generate", s.authenticated(requireMethod(http.MethodPost, s.generate)))
	s.mux.HandleFunc("/api/blend", s.authenticated(requireMethod(http.MethodPost, s.blend)))
	s.mux.HandleFunc("/api/learn", s.authenticated(requireMethod(http.MethodPost, s.learn)))
	s.mux.HandleFunc("/api/slidermap", s.authenticated(s.sliderMap))
	s.mux.HandleFunc("/api/folder/scan", s.authenticated(requireMethod(http.MethodGet, s.scanFolder)))
	s.mux.HandleFunc("/api/folder/read", s.authenticated(requireMethod(http.MethodPost, s.readPreset)))
	s.mux.HandleFunc("/api/save", s.authenticated(requireMethod(http.MethodPost, s.savePreset)))
	s.mux.HandleFunc("/api/shutdown", s.authenticated(requireMethod(http.MethodPost, s.shutdown)))

	if s.config.StaticFS != nil {
		if sub, err := fs.Sub(s.config.StaticFS, "."); err == nil {
			s.mux.Handle("/", http.FileServer(http.FS(sub)))
			return
		}
	}
	s.mux.HandleFunc("/", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = writer.Write([]byte(ProductName + " local service"))
	})
}

// status tells the UI what it can do right now: the fixed control catalogue plus
// which of those are calibrated. The UI must never claim a control works when it
// is absent from this list.
func (s *server) status(writer http.ResponseWriter, _ *http.Request) {
	sliders, err := s.sliders()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"name":             ProductName,
		"version":          Version,
		"presetVersion":    preset.SupportedVersion,
		"customizationDir": s.config.CustomizationDir,
		"controls":         preset.Controls,
		"metrics":          preset.Metrics(),
		"calibrations":     sliders.Calibrations,
		"sliderRegion":     map[string]int{"first": preset.SliderFirst, "last": preset.SliderLast},
	})
}

func decodePreset(encoded string) (*preset.Preset, []byte, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, nil, fmt.Errorf("preset data is not valid base64")
	}
	parsed, err := preset.Parse(raw)
	if err != nil {
		return nil, nil, err
	}
	return parsed, raw, nil
}

func presetPayload(built *preset.Preset) map[string]any {
	return map[string]any{
		"data":          base64.StdEncoding.EncodeToString(built.Bytes()),
		"sha256":        built.SHA256(),
		"classId":       int(built.Class()),
		"characterName": built.Name(),
	}
}

// inspect validates a preset the user picked from disk and reports its identity,
// so the UI never holds bytes it has not proved are a real version 20 preset.
func (s *server) inspect(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Name string `json:"name,omitempty"`
		Data string `json:"data"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	parsed, _, err := decodePreset(input.Data)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	payload := presetPayload(parsed)
	payload["name"] = input.Name
	payload["version"] = parsed.Version()
	writeJSON(writer, http.StatusOK, payload)
}

func (s *server) generate(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Base         string             `json:"base"`
		Measurements map[string]float64 `json:"measurements"`
		Strength     float64            `json:"strength"`
		Name         string             `json:"name,omitempty"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	base, _, err := decodePreset(input.Base)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Starting preset: "+err.Error())
		return
	}
	sliders, err := s.sliders()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	result, err := preset.Generate(base, input.Measurements, input.Strength, input.Name, sliders)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	payload := presetPayload(result.Preset)
	payload["applied"] = result.Applied
	payload["skipped"] = result.Skipped
	payload["warnings"] = result.Warnings
	writeJSON(writer, http.StatusOK, payload)
}

func (s *server) blend(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Base   string  `json:"base"`
		Donor  string  `json:"donor"`
		Weight float64 `json:"weight"`
		Name   string  `json:"name,omitempty"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	base, _, err := decodePreset(input.Base)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Base preset: "+err.Error())
		return
	}
	donor, _, err := decodePreset(input.Donor)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Donor preset: "+err.Error())
		return
	}
	result, err := preset.Blend(base, donor, input.Weight, input.Name)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	payload := presetPayload(result.Preset)
	payload["changedBytes"] = result.ChangedBytes
	payload["warnings"] = result.Warnings
	writeJSON(writer, http.StatusOK, payload)
}

// learn records where one control lives, from a base preset and a second one
// saved with only that slider dragged to maximum.
func (s *server) learn(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		ControlID string `json:"controlId"`
		Base      string `json:"base"`
		BaseName  string `json:"baseName,omitempty"`
		Maxed     string `json:"maxed"`
		MaxedName string `json:"maxedName,omitempty"`
		Commit    bool   `json:"commit"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	base, _, err := decodePreset(input.Base)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Base preset: "+err.Error())
		return
	}
	maxed, _, err := decodePreset(input.Maxed)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Maxed preset: "+err.Error())
		return
	}
	result, err := preset.Learn(base, maxed, input.ControlID, input.BaseName, input.MaxedName)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"error":   err.Error(),
			"status":  http.StatusBadRequest,
			"changes": result.Changes,
		})
		return
	}
	if input.Commit {
		sliders, loadErr := s.sliders()
		if loadErr != nil {
			writeError(writer, http.StatusInternalServerError, loadErr.Error())
			return
		}
		sliders.Upsert(result.Calibration)
		if saveErr := preset.SaveSliderMap(s.config.SliderMapPath, sliders); saveErr != nil {
			writeError(writer, http.StatusInternalServerError, saveErr.Error())
			return
		}
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"calibration": result.Calibration,
		"changes":     result.Changes,
		"warnings":    result.Warnings,
		"committed":   input.Commit,
	})
}

func (s *server) sliderMap(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		sliders, err := s.sliders()
		if err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, sliders)
	case http.MethodDelete:
		controlID := strings.TrimSpace(request.URL.Query().Get("controlId"))
		if controlID == "" {
			writeError(writer, http.StatusBadRequest, "controlId is required.")
			return
		}
		sliders, err := s.sliders()
		if err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		if !sliders.Remove(controlID) {
			writeError(writer, http.StatusNotFound, fmt.Sprintf("%q is not calibrated.", controlID))
			return
		}
		if err := preset.SaveSliderMap(s.config.SliderMapPath, sliders); err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, sliders)
	default:
		writer.Header().Set("Allow", http.MethodGet+", "+http.MethodDelete)
		writeError(writer, http.StatusMethodNotAllowed, "Method not allowed.")
	}
}

func (s *server) scanFolder(writer http.ResponseWriter, request *http.Request) {
	directory := strings.TrimSpace(request.URL.Query().Get("path"))
	if directory == "" {
		directory = s.config.CustomizationDir
	}
	result, err := storage.ScanPresets(directory)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *server) readPreset(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Path string `json:"path"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	path := filepath.Clean(strings.TrimSpace(input.Path))
	data, err := os.ReadFile(path)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Read preset: "+err.Error())
		return
	}
	parsed, err := preset.Parse(data)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	payload := presetPayload(parsed)
	payload["name"] = filepath.Base(path)
	payload["path"] = path
	writeJSON(writer, http.StatusOK, payload)
}

func (s *server) savePreset(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Directory string `json:"directory,omitempty"`
		Filename  string `json:"filename"`
		Data      string `json:"data"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	_, raw, err := decodePreset(input.Data)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	directory := strings.TrimSpace(input.Directory)
	if directory == "" {
		directory = s.config.CustomizationDir
	}
	result, err := storage.SavePreset(directory, input.Filename, raw)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *server) shutdown(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]any{"message": "FaceForge BDO is shutting down."})
	if s.config.Shutdown != nil {
		go s.config.Shutdown()
	}
}
