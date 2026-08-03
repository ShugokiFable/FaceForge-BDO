package preset

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func testSchema(t *testing.T) Schema {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "assets", "schema", "version20.json"))
	if err != nil {
		t.Fatal(err)
	}
	var schema Schema
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	if err := schema.Validate(); err != nil {
		t.Fatalf("schema validation: %v", err)
	}
	return schema
}

func parsedFixture(t *testing.T, name string) *Preset {
	t.Helper()
	parsed, err := Parse(loadFixture(t, name))
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestCompareFindsChangedBlocksAndRuns(t *testing.T) {
	cute := parsedFixture(t, "Cute Lahn")
	demure := parsedFixture(t, "Demure Lahn")

	comparison, err := Compare(cute, demure)
	if err != nil {
		t.Fatal(err)
	}

	if got, want := len(comparison.ChangedBlocks), 88; got != want {
		t.Fatalf("changed block count = %d, want %d", got, want)
	}
	if comparison.ChangedBlocks[0] != 0 || comparison.ChangedBlocks[len(comparison.ChangedBlocks)-1] != 113 {
		t.Fatalf("unexpected changed block bounds: %v", comparison.ChangedBlocks)
	}
	if len(comparison.Runs) == 0 || comparison.Runs[0] != (BlockRun{Start: 0, End: 2}) {
		t.Fatalf("first changed run = %+v, want 0..2", comparison.Runs)
	}
}

func TestExactGroupTransplantCopiesSelectedBlocksOnly(t *testing.T) {
	schema := testSchema(t)
	base := parsedFixture(t, "Cute Lahn")
	donor := parsedFixture(t, "Demure Lahn")

	result, err := Blend(base, map[string]*Preset{"demure": donor}, Recipe{
		Seed:   "test",
		Groups: []GroupBlend{{GroupID: "face_geometry", DonorID: "demure", Weight: 100}},
	}, schema)
	if err != nil {
		t.Fatal(err)
	}

	group, _ := schema.Group("face_geometry")
	selected := map[int]bool{}
	for _, index := range group.BlockIndices() {
		selected[index] = true
	}
	for index := 0; index < base.BlockCount(); index++ {
		got, _ := result.Preset.Block(index)
		baseBlock, _ := base.Block(index)
		donorBlock, _ := donor.Block(index)
		if selected[index] {
			if got != donorBlock {
				t.Fatalf("selected block %d was not copied from donor", index)
			}
		} else if got != baseBlock {
			t.Fatalf("unselected block %d changed", index)
		}
	}
}

func TestProtectedClassBlockIsNeverChangedByDefault(t *testing.T) {
	schema := testSchema(t)
	base := parsedFixture(t, "Cute Lahn")
	donor := parsedFixture(t, "Cute Maegu")

	result, err := Blend(base, map[string]*Preset{"maegu": donor}, Recipe{
		Seed:            "cross-class",
		AllowCrossClass: true,
		Groups:          []GroupBlend{{GroupID: "class", DonorID: "maegu", Weight: 100}},
	}, schema)
	if err != nil {
		t.Fatal(err)
	}

	got, _ := result.Preset.Block(ClassBlockIndex)
	want, _ := base.Block(ClassBlockIndex)
	if got != want {
		t.Fatalf("protected class block changed: got %x want %x", got, want)
	}
}

func TestWeightedBlendIsDeterministicAndProducesAnIntermediatePreset(t *testing.T) {
	schema := testSchema(t)
	base := parsedFixture(t, "Cute Lahn")
	donor := parsedFixture(t, "Demure Lahn")
	recipe := Recipe{
		Seed:   "stable-50",
		Groups: []GroupBlend{{GroupID: "face_geometry", DonorID: "demure", Weight: 50}},
	}

	first, err := Blend(base, map[string]*Preset{"demure": donor}, recipe, schema)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Blend(base, map[string]*Preset{"demure": donor}, recipe, schema)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first.Preset.Bytes(), second.Preset.Bytes()) {
		t.Fatal("same weighted recipe produced different output")
	}

	if first.ChangedBytes == 0 {
		t.Fatal("weighted decrypted blend did not change any plaintext customization bytes")
	}

	group, _ := schema.Group("face_geometry")
	foundIntermediate := false
	for _, index := range group.BlockIndices() {
		gotPlain, _ := first.Preset.PlainBlock(index)
		basePlain, _ := base.PlainBlock(index)
		donorPlain, _ := donor.PlainBlock(index)
		if gotPlain != basePlain && gotPlain != donorPlain {
			foundIntermediate = true
			break
		}
	}
	if !foundIntermediate {
		t.Fatal("expected at least one face_geometry block to be interpolated instead of copied from the base or donor")
	}
}

func TestWeightBoundariesReturnBaseOrDonor(t *testing.T) {
	schema := testSchema(t)
	base := parsedFixture(t, "Cute Lahn")
	donor := parsedFixture(t, "Demure Lahn")

	zero, err := Blend(base, map[string]*Preset{"d": donor}, Recipe{Groups: []GroupBlend{{GroupID: "hair", DonorID: "d", Weight: 0}}}, schema)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(zero.Preset.Bytes(), base.Bytes()) {
		t.Fatal("0% blend did not preserve base")
	}

	full, err := Blend(base, map[string]*Preset{"d": donor}, Recipe{Groups: []GroupBlend{{GroupID: "hair", DonorID: "d", Weight: 100}}}, schema)
	if err != nil {
		t.Fatal(err)
	}
	hair, _ := schema.Group("hair")
	for _, index := range hair.BlockIndices() {
		got, _ := full.Preset.Block(index)
		want, _ := donor.Block(index)
		if got != want {
			t.Fatalf("100%% blend block %d did not come from donor", index)
		}
	}
}

func TestCrossClassBlendRequiresExplicitPermission(t *testing.T) {
	schema := testSchema(t)
	base := parsedFixture(t, "Cute Lahn")
	donor := parsedFixture(t, "Cute Maegu")

	_, err := Blend(base, map[string]*Preset{"maegu": donor}, Recipe{
		Groups: []GroupBlend{{GroupID: "eyes_brows", DonorID: "maegu", Weight: 100}},
	}, schema)
	if err == nil {
		t.Fatal("cross-class blend unexpectedly succeeded without permission")
	}
}

func TestSchemaCoversEveryBlockExactlyOnce(t *testing.T) {
	schema := testSchema(t)
	got := schema.AllBlockIndices()
	want := make([]int, BlockCountV20)
	for i := range want {
		want[i] = i
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("schema block coverage = %v, want 0..%d exactly once", got, BlockCountV20-1)
	}
}
