package storage

import (
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
	Name          string    `json:"name"`
	Path          string    `json:"path"`
	Size          int64     `json:"size"`
	ModifiedAt    time.Time `json:"modifiedAt"`
	Version       uint32    `json:"version"`
	SHA256        string    `json:"sha256"`
	ClassID       int       `json:"classId"`
	CharacterName string    `json:"characterName"`
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
	return ScanPresetsInRoot(directory, directory)
}

// ScanPresetsInRoot lists presets in directory after proving it stays inside root.
func ScanPresetsInRoot(root, directory string) (ScanResult, error) {
	root = strings.TrimSpace(root)
	directory = strings.TrimSpace(directory)
	if root == "" || root == "." {
		return ScanResult{}, fmt.Errorf("customization directory is required")
	}
	if directory == "" || directory == "." {
		directory = root
	}

	entries, absDir, err := readDirWithin(root, directory)
	if err != nil {
		if os.IsNotExist(err) {
			confinedDir, resolveErr := confined(root, directory)
			if resolveErr != nil {
				return ScanResult{}, resolveErr
			}
			return ScanResult{Directory: confinedDir}, nil
		}
		return ScanResult{}, fmt.Errorf("scan customization directory: %w", err)
	}

	result := ScanResult{Directory: absDir}
	sep := string(filepath.Separator)
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if err := validFileName(entry.Name()); err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: skipped unsafe name", entry.Name()))
			continue
		}
		path, pathErr := confined(absDir, entry.Name())
		if pathErr != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", entry.Name(), pathErr))
			continue
		}
		if !withinRoot(absDir, path) {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", entry.Name(), errPathEscape))
			continue
		}
		if !strings.HasPrefix(path, prefixOf(absDir, path)+sep) {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", entry.Name(), errPathEscape))
			continue
		}
		data, readErr := readFileWithin(absDir, path)
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
		result.Presets = append(result.Presets, PresetFile{
			Name:          entry.Name(),
			Path:          path,
			Size:          info.Size(),
			ModifiedAt:    info.ModTime().UTC(),
			Version:       parsed.Version(),
			SHA256:        parsed.SHA256(),
			ClassID:       int(parsed.Class()),
			CharacterName: parsed.Name(),
		})
	}
	sort.Slice(result.Presets, func(i, j int) bool {
		return strings.ToLower(result.Presets[i].Name) < strings.ToLower(result.Presets[j].Name)
	})
	sort.Strings(result.Warnings)
	return result, nil
}
