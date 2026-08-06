package preset

import (
	"fmt"
	"math"
)

// BlendResult reports a face merge.
type BlendResult struct {
	Preset       *Preset  `json:"-"`
	ChangedBytes int      `json:"changedBytes"`
	Warnings     []string `json:"warnings,omitempty"`
}

// Blend mixes the donor's face and body sliders into the base at the given
// weight (0 keeps the base, 1 copies the donor).
//
// Only the slider region is mixed. Class, face type, hair, makeup and colours are
// kept from the base, because interpolating a style id or a colour channel
// produces a different asset rather than a halfway one.
func Blend(base, donor *Preset, weight float64, name string) (BlendResult, error) {
	if base == nil || donor == nil {
		return BlendResult{}, fmt.Errorf("both a base and a donor preset are required")
	}
	if math.IsNaN(weight) || weight < 0 || weight > 1 {
		return BlendResult{}, fmt.Errorf("weight must be between 0 and 1, got %v", weight)
	}

	result := BlendResult{}
	if base.Class() != donor.Class() {
		return result, fmt.Errorf(
			"the base is class %d and the donor is class %d. Classes use different head meshes, so mixing their sliders produces an unusable face",
			base.Class(), donor.Class())
	}

	plain := base.Edit()
	donorPlain := donor.plain
	for offset := SliderFirst; offset <= SliderLast; offset++ {
		if !IsSlider(offset) {
			continue
		}
		from := float64(plain[offset])
		to := float64(donorPlain[offset])
		mixed := int(math.Round(from + weight*(to-from)))
		if mixed < 0 {
			mixed = 0
		}
		if mixed > sliderMaximum {
			mixed = sliderMaximum
		}
		if byte(mixed) != plain[offset] {
			result.ChangedBytes++
		}
		plain[offset] = byte(mixed)
	}

	if name != "" {
		if err := SetName(plain, name); err != nil {
			return result, err
		}
	}

	built, err := FromPlain(plain)
	if err != nil {
		return result, fmt.Errorf("the merged preset failed validation and was discarded: %w", err)
	}
	result.Preset = built
	return result, nil
}
