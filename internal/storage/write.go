package storage

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
)

type SaveResult struct {
	Path       string `json:"path"`
	BackupPath string `json:"backupPath,omitempty"`
	SHA256     string `json:"sha256"`
	Size       int    `json:"size"`
}

func SavePreset(directory, filename string, data []byte) (SaveResult, error) {
	directory = filepath.Clean(strings.TrimSpace(directory))
	filename = strings.TrimSpace(filename)
	if directory == "" || directory == "." {
		return SaveResult{}, fmt.Errorf("customization directory is required")
	}
	if filename == "" || filename == "." || filename == ".." || filepath.Base(filename) != filename || strings.ContainsAny(filename, `/\\`) {
		return SaveResult{}, fmt.Errorf("filename must be a plain file name without path separators")
	}
	parsed, err := preset.Parse(data)
	if err != nil {
		return SaveResult{}, fmt.Errorf("refusing to save invalid preset: %w", err)
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return SaveResult{}, fmt.Errorf("create customization directory: %w", err)
	}

	target := filepath.Join(directory, filename)
	temp, err := os.CreateTemp(directory, ".faceforge-bdo-*.tmp")
	if err != nil {
		return SaveResult{}, fmt.Errorf("create temporary preset: %w", err)
	}
	tempPath := temp.Name()
	cleanupTemp := true
	defer func() {
		_ = temp.Close()
		if cleanupTemp {
			_ = os.Remove(tempPath)
		}
	}()
	if err := temp.Chmod(0o600); err != nil {
		return SaveResult{}, fmt.Errorf("secure temporary preset: %w", err)
	}
	if _, err := temp.Write(data); err != nil {
		return SaveResult{}, fmt.Errorf("write temporary preset: %w", err)
	}
	if err := temp.Sync(); err != nil {
		return SaveResult{}, fmt.Errorf("flush temporary preset: %w", err)
	}
	if err := temp.Close(); err != nil {
		return SaveResult{}, fmt.Errorf("close temporary preset: %w", err)
	}

	backupPath := ""
	if info, statErr := os.Stat(target); statErr == nil && !info.IsDir() {
		backupDir := filepath.Join(directory, ".FaceForge BDO Backups")
		if err := os.MkdirAll(backupDir, 0o755); err != nil {
			return SaveResult{}, fmt.Errorf("create backup directory: %w", err)
		}
		stamp := time.Now().UTC().Format("20060102-150405.000000000")
		backupPath = filepath.Join(backupDir, fmt.Sprintf("%s.%s.bak", filename, stamp))
		if err := copyFile(target, backupPath); err != nil {
			return SaveResult{}, fmt.Errorf("backup existing preset: %w", err)
		}
		if err := os.Remove(target); err != nil {
			return SaveResult{}, fmt.Errorf("prepare target replacement: %w", err)
		}
	} else if statErr != nil && !os.IsNotExist(statErr) {
		return SaveResult{}, fmt.Errorf("inspect target preset: %w", statErr)
	}

	if err := os.Rename(tempPath, target); err != nil {
		if backupPath != "" {
			_ = copyFile(backupPath, target)
		}
		return SaveResult{}, fmt.Errorf("install generated preset: %w", err)
	}
	cleanupTemp = false

	return SaveResult{
		Path:       target,
		BackupPath: backupPath,
		SHA256:     parsed.SHA256(),
		Size:       len(data),
	}, nil
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	success := false
	defer func() {
		_ = output.Close()
		if !success {
			_ = os.Remove(destination)
		}
	}()
	if _, err := io.Copy(output, input); err != nil {
		return err
	}
	if err := output.Sync(); err != nil {
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	success = true
	return nil
}
