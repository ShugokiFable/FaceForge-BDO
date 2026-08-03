package app

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/ShugokiFable/FaceForge-BDO/internal/calibration"
	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
	"github.com/ShugokiFable/FaceForge-BDO/internal/storage"
)

type encodedPresetRequest struct {
	Name string `json:"name,omitempty"`
	Data string `json:"data"`
}

type blockInfo struct {
	Index      int    `json:"index"`
	Hex        string `json:"hex"`
	IsDefault  bool   `json:"isDefault"`
	GroupID    string `json:"groupId,omitempty"`
	GroupName  string `json:"groupName,omitempty"`
	Protected  bool   `json:"protected"`
	Confidence string `json:"confidence,omitempty"`
}

func (s *server) routes() {
	s.mux.HandleFunc("/api/status", s.authenticated(requireMethod(http.MethodGet, s.status)))
	s.mux.HandleFunc("/api/inspect", s.authenticated(requireMethod(http.MethodPost, s.inspect)))
	s.mux.HandleFunc("/api/compare", s.authenticated(requireMethod(http.MethodPost, s.compare)))
	s.mux.HandleFunc("/api/blend", s.authenticated(requireMethod(http.MethodPost, s.blend)))
	s.mux.HandleFunc("/api/calibration/observe", s.authenticated(requireMethod(http.MethodPost, s.observeCalibration)))
	s.mux.HandleFunc("/api/reference-catalog", s.authenticated(s.referenceCatalog))
	s.mux.HandleFunc("/api/folder/scan", s.authenticated(requireMethod(http.MethodGet, s.scanFolder)))
	s.mux.HandleFunc("/api/folder/read", s.authenticated(requireMethod(http.MethodPost, s.readPreset)))
	s.mux.HandleFunc("/api/save", s.authenticated(requireMethod(http.MethodPost, s.savePreset)))
	s.mux.HandleFunc("/api/shutdown", s.authenticated(requireMethod(http.MethodPost, s.shutdown)))

	if s.config.StaticFS != nil {
		sub, err := fs.Sub(s.config.StaticFS, ".")
		if err == nil {
			s.mux.Handle("/", http.FileServer(http.FS(sub)))
			return
		}
	}
	s.mux.HandleFunc("/", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = writer.Write([]byte(ProductName + " local service"))
	})
}

func (s *server) referenceCatalog(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		catalog, err := storage.LoadReferenceCatalog(s.config.ReferenceCatalogPath)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, catalog)
	case http.MethodPost:
		var catalog storage.ReferenceCatalog
		if !decodeJSON(writer, request, &catalog) {
			return
		}
		if err := storage.SaveReferenceCatalog(s.config.ReferenceCatalogPath, catalog); err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		saved, err := storage.LoadReferenceCatalog(s.config.ReferenceCatalogPath)
		if err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, saved)
	default:
		writer.Header().Set("Allow", http.MethodGet+", "+http.MethodPost)
		writeError(writer, http.StatusMethodNotAllowed, "Method not allowed.")
	}
}

func (s *server) status(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]any{
		"name":             ProductName,
		"version":          Version,
		"presetVersion":    s.config.Schema.Version,
		"schemaName":       s.config.Schema.Name,
		"customizationDir": s.config.CustomizationDir,
		"groups":           s.config.Schema.Groups,
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

func (s *server) inspect(writer http.ResponseWriter, request *http.Request) {
	var input encodedPresetRequest
	if !decodeJSON(writer, request, &input) {
		return
	}
	parsed, _, err := decodePreset(input.Data)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	classBlock, _ := parsed.Block(preset.ClassBlockIndex)
	faceTypeBlock, _ := parsed.Block(preset.FaceTypeBlockIndex)
	groupsByBlock := make(map[int]preset.FeatureGroup)
	for _, group := range s.config.Schema.Groups {
		for _, index := range group.BlockIndices() {
			groupsByBlock[index] = group
		}
	}
	blocks := make([]blockInfo, 0, parsed.BlockCount())
	defaultCount := 0
	for index := 0; index < parsed.BlockCount(); index++ {
		block, _ := parsed.Block(index)
		group := groupsByBlock[index]
		isDefault := block == preset.DefaultCipherBlock
		if isDefault {
			defaultCount++
		}
		blocks = append(blocks, blockInfo{
			Index:      index,
			Hex:        hex.EncodeToString(block[:]),
			IsDefault:  isDefault,
			GroupID:    group.ID,
			GroupName:  group.Name,
			Protected:  group.Protected,
			Confidence: group.Confidence,
		})
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"name":                input.Name,
		"version":             parsed.Version(),
		"size":                len(parsed.Bytes()),
		"blockSize":           preset.BlockSize,
		"blockCount":          parsed.BlockCount(),
		"sha256":              parsed.SHA256(),
		"classFingerprint":    hex.EncodeToString(classBlock[:]),
		"faceTypeFingerprint": hex.EncodeToString(faceTypeBlock[:]),
		"defaultBlocks":       defaultCount,
		"blocks":              blocks,
	})
}

func (s *server) compare(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Left  string `json:"left"`
		Right string `json:"right"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	left, _, err := decodePreset(input.Left)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Left preset: "+err.Error())
		return
	}
	right, _, err := decodePreset(input.Right)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Right preset: "+err.Error())
		return
	}
	comparison, err := preset.Compare(left, right)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, comparison)
}

func (s *server) blend(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Base   string            `json:"base"`
		Donors map[string]string `json:"donors"`
		Recipe preset.Recipe     `json:"recipe"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	base, _, err := decodePreset(input.Base)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Base preset: "+err.Error())
		return
	}
	donors := make(map[string]*preset.Preset, len(input.Donors))
	for id, encoded := range input.Donors {
		donor, _, donorErr := decodePreset(encoded)
		if donorErr != nil {
			writeError(writer, http.StatusBadRequest, fmt.Sprintf("Donor %q: %v", id, donorErr))
			return
		}
		donors[id] = donor
	}
	result, err := preset.Blend(base, donors, input.Recipe, s.config.Schema)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	sidecar, _ := json.MarshalIndent(result, "", "  ")
	writeJSON(writer, http.StatusOK, map[string]any{
		"data":          base64.StdEncoding.EncodeToString(result.Preset.Bytes()),
		"sha256":        result.Preset.SHA256(),
		"changedBlocks": result.ChangedBlocks,
		"changedBytes":  result.ChangedBytes,
		"provenance":    result.Provenance,
		"warnings":      result.Warnings,
		"sidecar":       string(sidecar),
	})
}

func (s *server) observeCalibration(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Before string `json:"before"`
		After  string `json:"after"`
		Label  string `json:"label"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	before, _, err := decodePreset(input.Before)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "Before preset: "+err.Error())
		return
	}
	after, _, err := decodePreset(input.After)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "After preset: "+err.Error())
		return
	}
	observation, err := calibration.Observe(before, after, input.Label)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, observation)
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
	writeJSON(writer, http.StatusOK, map[string]any{
		"name":   filepath.Base(path),
		"path":   path,
		"data":   base64.StdEncoding.EncodeToString(data),
		"sha256": parsed.SHA256(),
	})
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
