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
	directory = strings.TrimSpace(directory)
	filename = strings.TrimSpace(filename)
	if directory == "" || directory == "." {
		return SaveResult{}, fmt.Errorf("customization directory is required")
	}
	if err := validFileName(filename); err != nil {
		return SaveResult{}, err
	}
	parsed, err := preset.Parse(data)
	if err != nil {
		return SaveResult{}, fmt.Errorf("refusing to save invalid preset: %w", err)
	}

	absDir, err := mkdirAllWithin(directory, directory, 0o755)
	if err != nil {
		return SaveResult{}, fmt.Errorf("create customization directory: %w", err)
	}

	target, err := confined(absDir, filename)
	if err != nil {
		return SaveResult{}, err
	}
	if !withinRoot(absDir, target) {
		return SaveResult{}, errPathEscape
	}
	prefix := prefixOf(absDir, target)
	sep := string(filepath.Separator)
	if !strings.HasPrefix(target, prefix+sep) {
		return SaveResult{}, errPathEscape
	}

	temp, err := createTempWithin(absDir, absDir, ".faceforge-bdo-*.tmp")
	if err != nil {
		return SaveResult{}, fmt.Errorf("create temporary preset: %w", err)
	}
	tempPath := temp.Name()
	if _, err := confined(absDir, tempPath); err != nil {
		_ = temp.Close()
		_ = os.Remove(tempPath)
		return SaveResult{}, err
	}
	cleanupTemp := true
	defer func() {
		_ = temp.Close()
		if cleanupTemp {
			_ = removeWithin(absDir, tempPath)
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
	info, statPath, statErr := statWithin(absDir, target)
	if statErr == nil && !info.IsDir() {
		backupDir, mkdirErr := mkdirAllWithin(absDir, filepath.Join(absDir, ".FaceForge BDO Backups"), 0o755)
		if mkdirErr != nil {
			return SaveResult{}, fmt.Errorf("create backup directory: %w", mkdirErr)
		}
		stamp := time.Now().UTC().Format("20060102-150405.000000000")
		backupName := fmt.Sprintf("%s.%s.bak", filename, stamp)
		if err := validFileName(backupName); err != nil {
			return SaveResult{}, err
		}
		backupPath, err = confined(backupDir, filepath.Join(backupDir, backupName))
		if err != nil {
			return SaveResult{}, err
		}
		if !withinRoot(absDir, backupPath) {
			return SaveResult{}, errPathEscape
		}
		backupPrefix := prefixOf(absDir, backupPath)
		if !strings.HasPrefix(backupPath, backupPrefix+sep) {
			return SaveResult{}, errPathEscape
		}
		if err := copyFile(absDir, statPath, backupPath); err != nil {
			return SaveResult{}, fmt.Errorf("backup existing preset: %w", err)
		}
		if err := removeWithin(absDir, statPath); err != nil {
			return SaveResult{}, fmt.Errorf("prepare target replacement: %w", err)
		}
	} else if statErr != nil && !os.IsNotExist(statErr) {
		return SaveResult{}, fmt.Errorf("inspect target preset: %w", statErr)
	}

	if err := renameWithin(absDir, tempPath, target); err != nil {
		if backupPath != "" {
			_ = copyFile(absDir, backupPath, target)
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

func copyFile(root, source, destination string) error {
	src, err := confined(root, source)
	if err != nil {
		return err
	}
	dst, err := confined(root, destination)
	if err != nil {
		return err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return err
	}
	if !withinRoot(absRoot, src) || !withinRoot(absRoot, dst) {
		return errPathEscape
	}
	sep := string(filepath.Separator)
	if !strings.HasPrefix(src, prefixOf(absRoot, src)+sep) {
		return errPathEscape
	}
	if !strings.HasPrefix(dst, prefixOf(absRoot, dst)+sep) {
		return errPathEscape
	}

	input, err := openWithin(root, src)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := openFileWithin(root, dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	success := false
	defer func() {
		_ = output.Close()
		if !success {
			_ = removeWithin(root, dst)
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
