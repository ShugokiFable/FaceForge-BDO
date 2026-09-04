package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

var errPathEscape = fmt.Errorf("path escapes allowed directory")

func validFileName(filename string) error {
	filename = strings.TrimSpace(filename)
	if filename == "" || filename == "." || filename == ".." {
		return fmt.Errorf("filename must be a plain file name without path separators")
	}
	if filepath.IsAbs(filename) || filepath.VolumeName(filename) != "" {
		return fmt.Errorf("filename must be a plain file name without path separators")
	}
	if filename != filepath.Base(filename) || strings.ContainsAny(filename, `/\\`) || strings.ContainsRune(filename, 0) {
		return fmt.Errorf("filename must be a plain file name without path separators")
	}
	if !filepath.IsLocal(filename) {
		return fmt.Errorf("filename must be a plain file name without path separators")
	}
	return nil
}

// canonicalPath returns an absolute path with existing symlinks evaluated.
// Missing trailing components are reattached to the longest existing prefix.
func canonicalPath(path string) (string, error) {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if cleaned == "" || cleaned == "." {
		return "", fmt.Errorf("path is required")
	}
	abs, err := filepath.Abs(cleaned)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)

	current := abs
	var missing []string
	for {
		resolved, err := filepath.EvalSymlinks(current)
		if err == nil {
			if len(missing) == 0 {
				return filepath.Clean(resolved), nil
			}
			parts := make([]string, 0, 1+len(missing))
			parts = append(parts, resolved)
			for i := len(missing) - 1; i >= 0; i-- {
				parts = append(parts, missing[i])
			}
			return filepath.Clean(filepath.Join(parts...)), nil
		}
		parent := filepath.Dir(current)
		if parent == current {
			return abs, nil
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
}

// withinRoot reports whether target is root or a descendant of root.
// The check is separator-aware so that "/safe" does not match "/safe-evil".
func withinRoot(root, target string) bool {
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	sep := string(filepath.Separator)
	if runtime.GOOS == "windows" {
		if strings.EqualFold(target, root) {
			return true
		}
		return strings.HasPrefix(strings.ToLower(target+sep), strings.ToLower(root+sep))
	}
	if target == root {
		return true
	}
	return strings.HasPrefix(target+sep, root+sep)
}

func prefixOf(root, target string) string {
	if len(target) >= len(root) && strings.EqualFold(target[:len(root)], root) {
		return target[:len(root)]
	}
	return root
}

// ResolveInside joins a user-supplied path with an allowed root (when relative),
// resolves it, and rejects anything that lands outside the root.
func ResolveInside(root, userPath string) (string, error) {
	root = strings.TrimSpace(root)
	userPath = strings.TrimSpace(userPath)
	if root == "" || root == "." {
		return "", fmt.Errorf("customization directory is required")
	}
	if userPath == "" || userPath == "." {
		return "", fmt.Errorf("path is required")
	}
	if strings.ContainsRune(userPath, 0) {
		return "", errPathEscape
	}

	absRoot, err := canonicalPath(root)
	if err != nil {
		return "", fmt.Errorf("resolve allowed directory: %w", err)
	}

	var candidate string
	if filepath.IsAbs(userPath) {
		candidate = userPath
	} else {
		if filepath.VolumeName(userPath) != "" || !filepath.IsLocal(userPath) {
			return "", errPathEscape
		}
		candidate = filepath.Join(absRoot, userPath)
	}

	absTarget, err := canonicalPath(candidate)
	if err != nil {
		return "", err
	}
	if !withinRoot(absRoot, absTarget) {
		return "", errPathEscape
	}

	prefix := prefixOf(absRoot, absTarget)
	sep := string(filepath.Separator)
	if absTarget != prefix && !strings.HasPrefix(absTarget, prefix+sep) {
		return "", errPathEscape
	}
	return absTarget, nil
}

func confined(root, userPath string) (string, error) {
	path, err := ResolveInside(root, userPath)
	if err != nil {
		return "", err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return "", err
	}
	if !withinRoot(absRoot, path) {
		return "", errPathEscape
	}
	prefix := prefixOf(absRoot, path)
	if !strings.HasPrefix(path, prefix) {
		return "", errPathEscape
	}
	return path, nil
}

func readDirWithin(root, userPath string) ([]os.DirEntry, string, error) {
	path, err := confined(root, userPath)
	if err != nil {
		return nil, "", err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return nil, "", err
	}
	if !withinRoot(absRoot, path) {
		return nil, "", errPathEscape
	}
	prefix := prefixOf(absRoot, path)
	if !strings.HasPrefix(path, prefix) {
		return nil, "", errPathEscape
	}
	entries, err := os.ReadDir(path)
	return entries, path, err
}

func readFileWithin(root, userPath string) ([]byte, error) {
	path, err := confined(root, userPath)
	if err != nil {
		return nil, err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return nil, err
	}
	if !withinRoot(absRoot, path) {
		return nil, errPathEscape
	}
	prefix := prefixOf(absRoot, path)
	sep := string(filepath.Separator)
	if !strings.HasPrefix(path, prefix+sep) {
		return nil, errPathEscape
	}
	return os.ReadFile(path)
}

func mkdirAllWithin(root, userPath string, perm os.FileMode) (string, error) {
	path, err := confined(root, userPath)
	if err != nil {
		return "", err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return "", err
	}
	if !withinRoot(absRoot, path) {
		return "", errPathEscape
	}
	prefix := prefixOf(absRoot, path)
	if !strings.HasPrefix(path, prefix) {
		return "", errPathEscape
	}
	if err := os.MkdirAll(path, perm); err != nil {
		return "", err
	}
	resolved, err := canonicalPath(path)
	if err != nil {
		return "", err
	}
	if !withinRoot(absRoot, resolved) {
		return "", errPathEscape
	}
	prefix = prefixOf(absRoot, resolved)
	if !strings.HasPrefix(resolved, prefix) {
		return "", errPathEscape
	}
	return resolved, nil
}

func createTempWithin(root, dir, pattern string) (*os.File, error) {
	path, err := confined(root, dir)
	if err != nil {
		return nil, err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return nil, err
	}
	if !withinRoot(absRoot, path) {
		return nil, errPathEscape
	}
	prefix := prefixOf(absRoot, path)
	if !strings.HasPrefix(path, prefix) {
		return nil, errPathEscape
	}
	return os.CreateTemp(path, pattern)
}

func statWithin(root, userPath string) (os.FileInfo, string, error) {
	path, err := confined(root, userPath)
	if err != nil {
		return nil, "", err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return nil, "", err
	}
	if !withinRoot(absRoot, path) {
		return nil, "", errPathEscape
	}
	prefix := prefixOf(absRoot, path)
	sep := string(filepath.Separator)
	if !strings.HasPrefix(path, prefix+sep) {
		return nil, "", errPathEscape
	}
	info, err := os.Stat(path)
	return info, path, err
}

func removeWithin(root, userPath string) error {
	path, err := confined(root, userPath)
	if err != nil {
		return err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return err
	}
	if !withinRoot(absRoot, path) {
		return errPathEscape
	}
	prefix := prefixOf(absRoot, path)
	sep := string(filepath.Separator)
	if !strings.HasPrefix(path, prefix+sep) {
		return errPathEscape
	}
	return os.Remove(path)
}

func renameWithin(root, oldPath, newPath string) error {
	from, err := confined(root, oldPath)
	if err != nil {
		return err
	}
	to, err := confined(root, newPath)
	if err != nil {
		return err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return err
	}
	if !withinRoot(absRoot, from) || !withinRoot(absRoot, to) {
		return errPathEscape
	}
	prefixFrom := prefixOf(absRoot, from)
	prefixTo := prefixOf(absRoot, to)
	sep := string(filepath.Separator)
	if !strings.HasPrefix(from, prefixFrom+sep) || !strings.HasPrefix(to, prefixTo+sep) {
		return errPathEscape
	}
	return os.Rename(from, to)
}

func openWithin(root, userPath string) (*os.File, error) {
	path, err := confined(root, userPath)
	if err != nil {
		return nil, err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return nil, err
	}
	if !withinRoot(absRoot, path) {
		return nil, errPathEscape
	}
	prefix := prefixOf(absRoot, path)
	sep := string(filepath.Separator)
	if !strings.HasPrefix(path, prefix+sep) {
		return nil, errPathEscape
	}
	return os.Open(path)
}

func openFileWithin(root, userPath string, flag int, perm os.FileMode) (*os.File, error) {
	path, err := confined(root, userPath)
	if err != nil {
		return nil, err
	}
	absRoot, err := canonicalPath(root)
	if err != nil {
		return nil, err
	}
	if !withinRoot(absRoot, path) {
		return nil, errPathEscape
	}
	prefix := prefixOf(absRoot, path)
	sep := string(filepath.Separator)
	if !strings.HasPrefix(path, prefix+sep) {
		return nil, errPathEscape
	}
	return os.OpenFile(path, flag, perm)
}

// ReadFileInside reads a file after verifying it resolves inside root.
func ReadFileInside(root, userPath string) ([]byte, error) {
	return readFileWithin(root, userPath)
}
