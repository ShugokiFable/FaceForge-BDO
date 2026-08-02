package storage

import (
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
)

const customizationOverrideEnv = "FACEFORGE_BDO_CUSTOMIZATION_DIR"

type PresetFile struct {
	Name             string    `json:"name"`
	Path             string    `json:"path"`
	Size             int64     `json:"size"`
	ModifiedAt       time.Time `json:"modifiedAt"`
	Version          uint32    `json:"version"`
	SHA256           string    `json:"sha256"`
	ClassFingerprint string    `json:"classFingerprint"`
	DefaultBlocks    int       `json:"defaultBlocks"`
}

type ScanResult struct {
	Directory string       `json:"directory"`
	Presets   []PresetFile `json:"presets"`
	Warnings  []string     `json:"warnings,omitempty"`
}

func DiscoverCustomizationDir() (string, error) {
	if override := strings.TrimSpace(os.Getenv(customizationOverrideEnv)); override != "" {
		return filepath.Clean(override), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("discover user home: %w", err)
	}

	candidates := make([]string, 0, 3)
	if oneDrive := strings.TrimSpace(os.Getenv("OneDrive")); oneDrive != "" {
		candidates = append(candidates, filepath.Join(oneDrive, "Documents", "Black Desert", "Customization"))
	}
	if profile := strings.TrimSpace(os.Getenv("USERPROFILE")); profile != "" {
		candidates = append(candidates, filepath.Join(profile, "Documents", "Black Desert", "Customization"))
	}
	candidates = append(candidates, filepath.Join(home, "Documents", "Black Desert", "Customization"))

	for _, candidate := range candidates {
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			return filepath.Clean(candidate), nil
		}
	}
	return filepath.Clean(candidates[len(candidates)-1]), nil
}

func ScanPresets(directory string) (ScanResult, error) {
	directory = filepath.Clean(strings.TrimSpace(directory))
	if directory == "." || directory == "" {
		return ScanResult{}, fmt.Errorf("customization directory is required")
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		if os.IsNotExist(err) {
			return ScanResult{Directory: directory}, nil
		}
		return ScanResult{}, fmt.Errorf("scan customization directory: %w", err)
	}

	result := ScanResult{Directory: directory}
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", entry.Name(), readErr))
			continue
		}
		parsed, parseErr := preset.Parse(data)
		if parseErr != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", entry.Name(), parseErr))
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", entry.Name(), infoErr))
			continue
		}
		classBlock, _ := parsed.Block(preset.ClassBlockIndex)
		defaultBlocks := 0
		for index := 0; index < parsed.BlockCount(); index++ {
			block, _ := parsed.Block(index)
			if block == preset.DefaultCipherBlock {
				defaultBlocks++
			}
		}
		result.Presets = append(result.Presets, PresetFile{
			Name:             entry.Name(),
			Path:             path,
			Size:             info.Size(),
			ModifiedAt:       info.ModTime().UTC(),
			Version:          parsed.Version(),
			SHA256:           parsed.SHA256(),
			ClassFingerprint: hex.EncodeToString(classBlock[:]),
			DefaultBlocks:    defaultBlocks,
		})
	}
	sort.Slice(result.Presets, func(i, j int) bool {
		return strings.ToLower(result.Presets[i].Name) < strings.ToLower(result.Presets[j].Name)
	})
	sort.Strings(result.Warnings)
	return result, nil
}
