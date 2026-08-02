package storage

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "presets", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestDiscoverCustomizationDirUsesEnvironmentOverride(t *testing.T) {
	expected := t.TempDir()
	t.Setenv("FACEFORGE_BDO_CUSTOMIZATION_DIR", expected)

	got, err := DiscoverCustomizationDir()
	if err != nil {
		t.Fatal(err)
	}
	if got != expected {
		t.Fatalf("DiscoverCustomizationDir() = %q, want %q", got, expected)
	}
}

func TestScanPresetsReturnsValidFilesAndInvalidWarnings(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "Cute Lahn"), fixture(t, "Cute Lahn"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "broken"), []byte("not a preset"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := ScanPresets(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Presets) != 1 || result.Presets[0].Name != "Cute Lahn" {
		t.Fatalf("presets = %+v", result.Presets)
	}
	if got, want := result.Presets[0].Version, uint32(20); got != want {
		t.Fatalf("version = %d, want %d", got, want)
	}
	if len(result.Warnings) != 1 {
		t.Fatalf("warnings = %v, want one invalid-file warning", result.Warnings)
	}
}

func TestSavePresetCreatesBackupBeforeOverwrite(t *testing.T) {
	dir := t.TempDir()
	first := fixture(t, "Cute Lahn")
	second := fixture(t, "Demure Lahn")

	initial, err := SavePreset(dir, "CustomizationData", first)
	if err != nil {
		t.Fatal(err)
	}
	if initial.BackupPath != "" {
		t.Fatalf("first save backup = %q, want empty", initial.BackupPath)
	}

	overwritten, err := SavePreset(dir, "CustomizationData", second)
	if err != nil {
		t.Fatal(err)
	}
	if overwritten.BackupPath == "" {
		t.Fatal("overwrite did not create a backup")
	}
	backup, err := os.ReadFile(overwritten.BackupPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(backup, first) {
		t.Fatal("backup does not contain the original preset")
	}
	current, err := os.ReadFile(filepath.Join(dir, "CustomizationData"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(current, second) {
		t.Fatal("target does not contain the replacement preset")
	}
}

func TestSavePresetRejectsTraversalAndInvalidData(t *testing.T) {
	dir := t.TempDir()
	if _, err := SavePreset(dir, "../escape", fixture(t, "Cute Lahn")); err == nil {
		t.Fatal("SavePreset unexpectedly accepted path traversal")
	}
	if _, err := SavePreset(dir, "CustomizationData", make([]byte, preset.ExpectedSizeV20)); err == nil {
		t.Fatal("SavePreset unexpectedly accepted unsupported version data")
	}
}
