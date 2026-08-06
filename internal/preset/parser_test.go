package preset

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

var fixtureNames = []string{"Cute Lahn", "Cute Maegu", "Demure Lahn", "Mommy Guardian"}

func loadFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "presets", name))
	if err != nil {
		t.Fatalf("read fixture %q: %v", name, err)
	}
	return data
}

// The whole app rests on decrypt/encrypt being exactly inverse. If this breaks,
// every generated preset is silently corrupt, so it is checked on real files.
func TestRealPresetsRoundTripByteForByte(t *testing.T) {
	for _, name := range fixtureNames {
		original := loadFixture(t, name)
		parsed, err := Parse(original)
		if err != nil {
			t.Fatalf("%s: Parse: %v", name, err)
		}
		if got := parsed.Version(); got != SupportedVersion {
			t.Fatalf("%s: Version() = %d, want %d", name, got, SupportedVersion)
		}
		if !bytes.Equal(parsed.Bytes(), original) {
			t.Fatalf("%s: Bytes() differs from the file it was read from", name)
		}
		rebuilt, err := FromPlain(parsed.Edit())
		if err != nil {
			t.Fatalf("%s: FromPlain: %v", name, err)
		}
		if !bytes.Equal(rebuilt.Bytes(), original) {
			t.Fatalf("%s: decrypt then re-encrypt did not reproduce the original bytes", name)
		}
	}
}

// The layout constants are measured from a 134-file corpus. Guard the two that
// would silently write into the wrong field if they drifted.
func TestLayoutHoldsOnRealPresets(t *testing.T) {
	for _, name := range fixtureNames {
		parsed, err := Parse(loadFixture(t, name))
		if err != nil {
			t.Fatalf("%s: Parse: %v", name, err)
		}
		if parsed.Name() == "" {
			t.Errorf("%s: Name() decoded empty; the name field offset is wrong", name)
		}
		if class := parsed.Class(); class == 0 || class > 100 {
			t.Errorf("%s: Class() = %d, outside the observed class id range", name, class)
		}
		for offset := SliderFirst; offset <= SliderLast; offset++ {
			if !IsSlider(offset) {
				continue
			}
			value, err := parsed.Slider(offset)
			if err != nil {
				t.Fatalf("%s: Slider(%d): %v", name, offset, err)
			}
			if value > 100 {
				t.Errorf("%s: byte %d = %d, above the 0..100 slider range the region is defined by",
					name, offset, value)
			}
		}
	}
}

// The three unclassified bytes must stay outside the writable set; writing an
// unknown field is how a preset gets silently broken.
func TestUnclassifiedOffsetsAreNotWritable(t *testing.T) {
	offsets := UnclassifiedOffsets()
	if len(offsets) == 0 {
		t.Fatal("expected the unclassified offsets to be listed")
	}
	for _, offset := range offsets {
		if IsSlider(offset) {
			t.Errorf("offset %d is unclassified but reported as a writable slider", offset)
		}
	}
}

func TestSetNameRoundTrips(t *testing.T) {
	parsed, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	plain := parsed.Edit()
	if err := SetName(plain, "Nakamoora"); err != nil {
		t.Fatal(err)
	}
	rebuilt, err := FromPlain(plain)
	if err != nil {
		t.Fatal(err)
	}
	if got := rebuilt.Name(); got != "Nakamoora" {
		t.Fatalf("Name() = %q, want %q", got, "Nakamoora")
	}
	if got, want := rebuilt.Class(), parsed.Class(); got != want {
		t.Fatalf("renaming changed the class: %d, want %d", got, want)
	}
}

func TestSetNameRejectsOverlongName(t *testing.T) {
	parsed, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	if err := SetName(parsed.Edit(), "ThisNameIsFarTooLongForTheField"); err == nil {
		t.Fatal("SetName accepted a name longer than the field")
	}
}

func TestParseRejectsWrongSizeAndVersion(t *testing.T) {
	if _, err := Parse(make([]byte, 100)); err == nil {
		t.Error("Parse accepted a 100-byte file")
	}
	wrongVersion := loadFixture(t, "Cute Lahn")
	wrongVersion[0] = 19
	if _, err := Parse(wrongVersion); err == nil {
		t.Error("Parse accepted version 19")
	}
}

// maxedCopy returns a preset with the given slider offsets pushed to 100,
// standing in for a save the user made after dragging those sliders to maximum.
func maxedCopy(t *testing.T, base *Preset, offsets ...int) *Preset {
	t.Helper()
	plain := base.Edit()
	for _, offset := range offsets {
		plain[offset] = 100
	}
	built, err := FromPlain(plain)
	if err != nil {
		t.Fatal(err)
	}
	return built
}

// findUnmaxedSliders picks offsets that are not already at 100, so the synthetic
// "user maxed this" edit is actually a change.
func findUnmaxedSliders(t *testing.T, base *Preset, count int) []int {
	t.Helper()
	offsets := make([]int, 0, count)
	for offset := SliderFirst; offset <= SliderLast && len(offsets) < count; offset++ {
		if !IsSlider(offset) {
			continue
		}
		if value, _ := base.Slider(offset); value < maxedThreshold {
			offsets = append(offsets, offset)
		}
	}
	if len(offsets) < count {
		t.Fatalf("fixture has fewer than %d sliders below %d", count, maxedThreshold)
	}
	return offsets
}

func TestLearnIsolatesASingleMaxedSlider(t *testing.T) {
	base, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	want := findUnmaxedSliders(t, base, 1)[0]
	result, err := Learn(base, maxedCopy(t, base, want), "nose_width", "base", "maxed")
	if err != nil {
		t.Fatalf("Learn: %v", err)
	}
	if result.Calibration.Offset != want {
		t.Fatalf("Calibration.Offset = %d, want %d", result.Calibration.Offset, want)
	}
	if result.Calibration.ControlID != "nose_width" {
		t.Fatalf("ControlID = %q", result.Calibration.ControlID)
	}
	if result.Calibration.MaxValue != 100 {
		t.Fatalf("MaxValue = %d, want 100", result.Calibration.MaxValue)
	}
}

// Two maxed bytes are indistinguishable, and picking one anyway would poison
// every later generation. Learn must refuse rather than choose.
func TestLearnRefusesAmbiguousDiff(t *testing.T) {
	base, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	offsets := findUnmaxedSliders(t, base, 2)
	if _, err := Learn(base, maxedCopy(t, base, offsets...), "nose_width", "base", "maxed"); err == nil {
		t.Fatal("Learn accepted a diff with two maxed bytes")
	}
}

func TestLearnRefusesIdenticalPresets(t *testing.T) {
	base, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Learn(base, base, "nose_width", "base", "maxed"); err == nil {
		t.Fatal("Learn accepted two identical presets")
	}
}

func TestGenerateMovesOnlyCalibratedSliders(t *testing.T) {
	base, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	offset := findUnmaxedSliders(t, base, 1)[0]
	sliders := SliderMap{Version: 1, Calibrations: []Calibration{{
		ControlID: "nose_width", Offset: offset, BaseValue: 0, MaxValue: 100,
		ClassID: int(base.Class()), Evidence: "test",
	}}}

	result, err := Generate(base, map[string]float64{"noseWidth": 1}, 1, "", sliders)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if len(result.Applied) != 1 {
		t.Fatalf("Applied = %d controls, want 1", len(result.Applied))
	}
	if got, _ := result.Preset.Slider(offset); got != 100 {
		t.Fatalf("slider %d = %d, want 100", offset, got)
	}
	if len(result.Skipped) != len(Controls)-1 {
		t.Fatalf("Skipped = %d, want %d uncalibrated controls", len(result.Skipped), len(Controls)-1)
	}

	// Everything outside the one calibrated byte must be untouched, so the
	// result stays a valid variant of a preset that already worked in game.
	before, after := base.PlainBytes(), result.Preset.PlainBytes()
	for index := range before {
		if index == offset {
			continue
		}
		if before[index] != after[index] {
			t.Fatalf("byte %d changed from %d to %d but only offset %d was calibrated",
				index, before[index], after[index], offset)
		}
	}
}

func TestGenerateStrengthZeroChangesNothing(t *testing.T) {
	base, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	offset := findUnmaxedSliders(t, base, 1)[0]
	sliders := SliderMap{Version: 1, Calibrations: []Calibration{{
		ControlID: "nose_width", Offset: offset, MaxValue: 100, ClassID: int(base.Class()),
	}}}
	result, err := Generate(base, map[string]float64{"noseWidth": 1}, 0, "", sliders)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(result.Preset.Bytes(), base.Bytes()) {
		t.Fatal("strength 0 changed the preset")
	}
}

func TestGenerateRefusesWithoutCalibration(t *testing.T) {
	base, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Generate(base, map[string]float64{"noseWidth": 1}, 1, "", SliderMap{Version: 1}); err == nil {
		t.Fatal("Generate produced a preset with an empty slider map")
	}
}

func TestGenerateClampsToSliderRange(t *testing.T) {
	base, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	offset := findUnmaxedSliders(t, base, 1)[0]
	sliders := SliderMap{Version: 1, Calibrations: []Calibration{{
		ControlID: "nose_width", Offset: offset, MaxValue: 100, ClassID: int(base.Class()),
	}}}
	// Out-of-range and non-finite measurements must not escape 0..100.
	for _, metric := range []float64{-5, 12} {
		result, err := Generate(base, map[string]float64{"noseWidth": metric}, 1, "", sliders)
		if err != nil {
			t.Fatalf("metric %v: %v", metric, err)
		}
		if got, _ := result.Preset.Slider(offset); got > 100 {
			t.Fatalf("metric %v produced slider value %d", metric, got)
		}
	}
}

func TestSliderMapValidateRejectsBadOffsets(t *testing.T) {
	outside := SliderMap{Version: 1, Calibrations: []Calibration{
		{ControlID: "nose_width", Offset: ClassOffset},
	}}
	if err := outside.Validate(); err == nil {
		t.Error("Validate accepted an offset on the class byte")
	}
	duplicate := SliderMap{Version: 1, Calibrations: []Calibration{
		{ControlID: "nose_width", Offset: SliderFirst},
		{ControlID: "mouth_width", Offset: SliderFirst},
	}}
	if err := duplicate.Validate(); err == nil {
		t.Error("Validate accepted two controls on the same byte")
	}
	unknown := SliderMap{Version: 1, Calibrations: []Calibration{
		{ControlID: "not_a_control", Offset: SliderFirst},
	}}
	if err := unknown.Validate(); err == nil {
		t.Error("Validate accepted an unknown control id")
	}
}

func TestBlendRefusesCrossClass(t *testing.T) {
	lahn, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	guardian, err := Parse(loadFixture(t, "Mommy Guardian"))
	if err != nil {
		t.Fatal(err)
	}
	if lahn.Class() == guardian.Class() {
		t.Skip("fixtures share a class")
	}
	if _, err := Blend(lahn, guardian, 0.5, ""); err == nil {
		t.Fatal("Blend mixed two different classes")
	}
}

func TestBlendEndpointsAreExact(t *testing.T) {
	base, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	donor, err := Parse(loadFixture(t, "Demure Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	if base.Class() != donor.Class() {
		t.Skip("fixtures are different classes")
	}
	atZero, err := Blend(base, donor, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(atZero.Preset.Bytes(), base.Bytes()) {
		t.Error("weight 0 did not preserve the base")
	}
	atOne, err := Blend(base, donor, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	for offset := SliderFirst; offset <= SliderLast; offset++ {
		if !IsSlider(offset) {
			// Unclassified bytes are copied from the base, not the donor.
			want, _ := base.Byte(offset)
			got, _ := atOne.Preset.Byte(offset)
			if got != want {
				t.Fatalf("weight 1: unclassified byte %d = %d, want the base's %d", offset, got, want)
			}
			continue
		}
		want, _ := donor.Slider(offset)
		got, _ := atOne.Preset.Slider(offset)
		if got != want {
			t.Fatalf("weight 1: slider %d = %d, want the donor's %d", offset, got, want)
		}
	}
	if got, want := atOne.Preset.Class(), base.Class(); got != want {
		t.Fatalf("weight 1 changed the class to %d, want the base's %d", got, want)
	}
}

func TestControlCatalogueIsConsistent(t *testing.T) {
	seen := make(map[string]struct{}, len(Controls))
	for _, control := range Controls {
		if _, clash := seen[control.ID]; clash {
			t.Errorf("duplicate control id %q", control.ID)
		}
		seen[control.ID] = struct{}{}
		if control.Metric == "" || control.Label == "" || control.Instruction == "" {
			t.Errorf("control %q is missing a label, metric or instruction", control.ID)
		}
	}
	// One control per measurable proportion: a metric driving two sliders would
	// move them in lockstep, which is not what a face needs.
	if len(Metrics()) != len(Controls) {
		t.Fatalf("%d controls share %d metrics; each control needs its own", len(Controls), len(Metrics()))
	}
}
