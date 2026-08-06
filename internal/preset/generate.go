package preset

import (
	"fmt"
	"math"
	"sort"
)

// sliderMaximum is the top of a slider byte's range. Corpus evidence: every
// varying byte in the slider region stays within 0..100 and 100 is observed.
const sliderMaximum = 100

// AppliedControl is one slider FaceForge actually moved.
type AppliedControl struct {
	ControlID   string  `json:"controlId"`
	Label       string  `json:"label"`
	Offset      int     `json:"offset"`
	Metric      string  `json:"metric"`
	MetricValue float64 `json:"metricValue"`
	From        int     `json:"from"`
	Target      int     `json:"target"`
	To          int     `json:"to"`
}

// SkippedControl is one slider FaceForge could not move, and why.
type SkippedControl struct {
	ControlID string `json:"controlId"`
	Label     string `json:"label"`
	Reason    string `json:"reason"`
}

// GenerateResult is the outcome of a photo-driven generation.
type GenerateResult struct {
	Preset   *Preset          `json:"-"`
	Applied  []AppliedControl `json:"applied"`
	Skipped  []SkippedControl `json:"skipped"`
	Warnings []string         `json:"warnings,omitempty"`
}

// Generate builds a new preset from a base plus measurements taken from a photo.
//
// Only calibrated controls are touched. Everything else — class, face type, hair,
// makeup, colours, body, and every uncalibrated slider — is copied from the base
// byte for byte, so the result is always a valid variant of a preset that already
// worked in game.
//
// measurements are the normalized 0..1 values from the face analyzer. strength is
// how far to move from the base value toward the photo's implied value: 1 lands
// exactly on it, 0 changes nothing.
func Generate(base *Preset, measurements map[string]float64, strength float64, name string, sliders SliderMap) (GenerateResult, error) {
	if base == nil {
		return GenerateResult{}, fmt.Errorf("a starting preset is required")
	}
	if len(measurements) == 0 {
		return GenerateResult{}, fmt.Errorf("no face measurements were supplied")
	}
	if err := sliders.Validate(); err != nil {
		return GenerateResult{}, err
	}
	if math.IsNaN(strength) || strength < 0 || strength > 1 {
		return GenerateResult{}, fmt.Errorf("strength must be between 0 and 1, got %v", strength)
	}

	plain := base.Edit()
	// Always non-nil so the UI never has to distinguish "none" from "absent".
	result := GenerateResult{
		Applied: make([]AppliedControl, 0, len(Controls)),
		Skipped: make([]SkippedControl, 0, len(Controls)),
	}

	if name != "" {
		if err := SetName(plain, name); err != nil {
			return GenerateResult{}, err
		}
	}

	baseClass := int(base.Class())
	for _, control := range Controls {
		calibration, calibrated := sliders.Find(control.ID)
		if !calibrated {
			result.Skipped = append(result.Skipped, SkippedControl{
				ControlID: control.ID, Label: control.Label,
				Reason: "not calibrated yet",
			})
			continue
		}
		value, measured := measurements[control.Metric]
		if !measured || math.IsNaN(value) {
			result.Skipped = append(result.Skipped, SkippedControl{
				ControlID: control.ID, Label: control.Label,
				Reason: fmt.Sprintf("the photo did not yield a %s measurement", control.Metric),
			})
			continue
		}
		if calibration.ClassID != baseClass {
			result.Warnings = append(result.Warnings, fmt.Sprintf(
				"%s was calibrated on class %d but this preset is class %d; if the result looks wrong, recalibrate on this class.",
				control.Label, calibration.ClassID, baseClass))
		}

		normalized := clamp01(value)
		if control.Invert {
			normalized = 1 - normalized
		}
		target := int(math.Round(normalized * sliderMaximum))
		from := int(plain[calibration.Offset])
		to := int(math.Round(float64(from) + strength*float64(target-from)))
		if to < 0 {
			to = 0
		}
		if to > sliderMaximum {
			to = sliderMaximum
		}
		plain[calibration.Offset] = byte(to)

		result.Applied = append(result.Applied, AppliedControl{
			ControlID: control.ID, Label: control.Label, Offset: calibration.Offset,
			Metric: control.Metric, MetricValue: normalized,
			From: from, Target: target, To: to,
		})
	}

	if len(result.Applied) == 0 {
		return result, fmt.Errorf(
			"none of the %d controls are calibrated yet, so there is nothing to drive from the photo. Run Learn Sliders first",
			len(Controls))
	}

	sort.Slice(result.Applied, func(i, j int) bool { return result.Applied[i].Offset < result.Applied[j].Offset })

	built, err := FromPlain(plain)
	if err != nil {
		return result, fmt.Errorf("the generated preset failed validation and was discarded: %w", err)
	}
	result.Preset = built
	return result, nil
}

func clamp01(value float64) float64 {
	if math.IsNaN(value) {
		return 0
	}
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}
