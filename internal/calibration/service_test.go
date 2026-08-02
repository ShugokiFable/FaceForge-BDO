package calibration

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
)

func makePreset(t *testing.T, changed ...int) *preset.Preset {
	t.Helper()
	raw := make([]byte, preset.ExpectedSizeV20)
	raw[0] = byte(preset.SupportedVersion)
	for i := 0; i < preset.BlockCountV20; i++ {
		start := preset.HeaderSize + i*preset.BlockSize
		copy(raw[start:start+preset.BlockSize], preset.DefaultCipherBlock[:])
	}
	for _, index := range changed {
		start := preset.HeaderSize + index*preset.BlockSize
		raw[start] ^= byte(index + 1)
	}
	parsed, err := preset.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestObserveCapturesChangedBlocks(t *testing.T) {
	before := makePreset(t)
	after := makePreset(t, 12, 15, 16)

	observation, err := Observe(before, after, "Nose width")
	if err != nil {
		t.Fatal(err)
	}
	if observation.Label != "Nose width" {
		t.Fatalf("label = %q", observation.Label)
	}
	if !reflect.DeepEqual(observation.ChangedBlocks, []int{12, 15, 16}) {
		t.Fatalf("changed blocks = %v", observation.ChangedBlocks)
	}
	if observation.BeforeSHA256 == observation.AfterSHA256 {
		t.Fatal("before and after hashes unexpectedly match")
	}
}

func TestDatabaseRejectsMismatchedPresetVersion(t *testing.T) {
	db := NewDatabase(preset.SupportedVersion)
	observation, _ := Observe(makePreset(t), makePreset(t, 10), "Jaw")
	observation.PresetVersion = 19

	if err := db.Merge(observation, MergeUnion); err == nil {
		t.Fatal("Database unexpectedly accepted an observation from another preset version")
	}
}

func TestDatabaseUnionMerge(t *testing.T) {
	db := NewDatabase(preset.SupportedVersion)
	first, _ := Observe(makePreset(t), makePreset(t, 10, 11), "Eye spacing")
	second, _ := Observe(makePreset(t), makePreset(t, 11, 12), "Eye spacing")

	if err := db.Merge(first, MergeUnion); err != nil {
		t.Fatal(err)
	}
	if err := db.Merge(second, MergeUnion); err != nil {
		t.Fatal(err)
	}

	mapping := db.Mappings["eye spacing"]
	if !reflect.DeepEqual(mapping.Blocks, []int{10, 11, 12}) {
		t.Fatalf("union blocks = %v", mapping.Blocks)
	}
	if mapping.Observations != 2 {
		t.Fatalf("observation count = %d", mapping.Observations)
	}
}

func TestDatabaseIntersectionMerge(t *testing.T) {
	db := NewDatabase(preset.SupportedVersion)
	first, _ := Observe(makePreset(t), makePreset(t, 10, 11, 12), "Mouth width")
	second, _ := Observe(makePreset(t), makePreset(t, 11, 12, 13), "Mouth width")

	if err := db.Merge(first, MergeIntersection); err != nil {
		t.Fatal(err)
	}
	if err := db.Merge(second, MergeIntersection); err != nil {
		t.Fatal(err)
	}

	if got := db.Mappings["mouth width"].Blocks; !reflect.DeepEqual(got, []int{11, 12}) {
		t.Fatalf("intersection blocks = %v", got)
	}
}

func TestDatabaseJSONRoundTrip(t *testing.T) {
	db := NewDatabase(preset.SupportedVersion)
	observation, _ := Observe(makePreset(t), makePreset(t, 22, 23), "Chin depth")
	if err := db.Merge(observation, MergeUnion); err != nil {
		t.Fatal(err)
	}

	encoded, err := json.Marshal(db)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Database
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(db, &decoded) {
		t.Fatalf("round trip mismatch:\noriginal=%+v\ndecoded=%+v", db, &decoded)
	}
}
