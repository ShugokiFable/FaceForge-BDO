package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ReferenceProfile struct {
	SHA256           string             `json:"sha256"`
	Name             string             `json:"name"`
	ClassFingerprint string             `json:"classFingerprint"`
	ImageName        string             `json:"imageName"`
	Metrics          map[string]float64 `json:"metrics"`
	Quality          map[string]float64 `json:"quality"`
	ProfiledAt       string             `json:"profiledAt,omitempty"`
}

type ReferenceCatalog struct {
	Version   int                         `json:"version"`
	UpdatedAt string                      `json:"updatedAt,omitempty"`
	Profiles  map[string]ReferenceProfile `json:"profiles"`
}

func EmptyReferenceCatalog() ReferenceCatalog {
	return ReferenceCatalog{Version: 1, Profiles: map[string]ReferenceProfile{}}
}

func normalizeReferenceCatalog(catalog ReferenceCatalog) ReferenceCatalog {
	if catalog.Version == 0 {
		catalog.Version = 1
	}
	normalized := make(map[string]ReferenceProfile, len(catalog.Profiles))
	for key, profile := range catalog.Profiles {
		sha := strings.ToLower(strings.TrimSpace(profile.SHA256))
		if sha == "" {
			sha = strings.ToLower(strings.TrimSpace(key))
		}
		if sha == "" {
			continue
		}
		profile.SHA256 = sha
		profile.Name = strings.TrimSpace(profile.Name)
		profile.ClassFingerprint = strings.TrimSpace(profile.ClassFingerprint)
		profile.ImageName = strings.TrimSpace(profile.ImageName)
		if profile.Metrics == nil {
			profile.Metrics = map[string]float64{}
		}
		if profile.Quality == nil {
			profile.Quality = map[string]float64{}
		}
		if strings.TrimSpace(profile.ProfiledAt) == "" {
			profile.ProfiledAt = time.Now().UTC().Format(time.RFC3339)
		}
		normalized[sha] = profile
	}
	catalog.Profiles = normalized
	return catalog
}

func LoadReferenceCatalog(path string) (ReferenceCatalog, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" || path == "." {
		return EmptyReferenceCatalog(), nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return EmptyReferenceCatalog(), nil
	}
	if err != nil {
		return ReferenceCatalog{}, fmt.Errorf("read reference catalog: %w", err)
	}
	var catalog ReferenceCatalog
	if err := json.Unmarshal(data, &catalog); err != nil {
		return ReferenceCatalog{}, fmt.Errorf("decode reference catalog: %w", err)
	}
	return normalizeReferenceCatalog(catalog), nil
}

func SaveReferenceCatalog(path string, catalog ReferenceCatalog) error {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" || path == "." {
		return errors.New("reference catalog path is not configured")
	}
	catalog = normalizeReferenceCatalog(catalog)
	catalog.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	data, err := json.MarshalIndent(catalog, "", "  ")
	if err != nil {
		return fmt.Errorf("encode reference catalog: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create reference catalog directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".reference-catalog-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary reference catalog: %w", err)
	}
	temporaryPath := temporary.Name()
	cleanup := func() { _ = os.Remove(temporaryPath) }
	defer cleanup()
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write reference catalog: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync reference catalog: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close reference catalog: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(path)
		if retryErr := os.Rename(temporaryPath, path); retryErr != nil {
			return fmt.Errorf("replace reference catalog: %w", retryErr)
		}
	}
	return nil
}
