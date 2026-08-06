package preset

import (
	"fmt"
	"time"
)

// maxedThreshold is how close to 100 a byte must land to count as "the user
// dragged that slider to its maximum". Corpus evidence: slider bytes top out at
// exactly 100, so this only tolerates a user who did not quite reach the end.
const maxedThreshold = 90

// A ByteChange is one differing plaintext byte inside the slider region.
type ByteChange struct {
	Offset int `json:"offset"`
	Before int `json:"before"`
	After  int `json:"after"`
}

// LearnResult reports what a base/maxed pair proved.
type LearnResult struct {
	Calibration Calibration  `json:"calibration"`
	Changes     []ByteChange `json:"changes"`
	Warnings    []string     `json:"warnings,omitempty"`
}

// Learn identifies which byte a named control occupies, by diffing a base preset
// against one saved with that single slider dragged to its maximum.
//
// It refuses to guess. If the diff does not isolate exactly one maxed byte, it
// returns the candidates and an error explaining what to re-save, because a
// wrong offset here would silently corrupt every preset generated afterwards.
func Learn(base, maxed *Preset, controlID, baseName, maxedName string) (LearnResult, error) {
	control, known := ControlByID(controlID)
	if !known {
		return LearnResult{}, fmt.Errorf("unknown control %q", controlID)
	}
	if base == nil || maxed == nil {
		return LearnResult{}, fmt.Errorf("both a base preset and a maxed preset are required")
	}

	result := LearnResult{Changes: []ByteChange{}}
	if base.Class() != maxed.Class() {
		return result, fmt.Errorf(
			"the two presets are different classes (%d and %d); calibrate with two saves of the same character",
			base.Class(), maxed.Class())
	}

	basePlain := base.plain
	maxedPlain := maxed.plain
	for offset := SliderFirst; offset <= SliderLast; offset++ {
		if !IsSlider(offset) {
			continue
		}
		if basePlain[offset] != maxedPlain[offset] {
			result.Changes = append(result.Changes, ByteChange{
				Offset: offset,
				Before: int(basePlain[offset]),
				After:  int(maxedPlain[offset]),
			})
		}
	}

	if len(result.Changes) == 0 {
		return result, fmt.Errorf(
			"no slider byte changed between those two files. Re-save the second one after moving only %q: %s",
			control.Label, control.Instruction)
	}

	maxedChanges := make([]ByteChange, 0, len(result.Changes))
	for _, change := range result.Changes {
		if change.After >= maxedThreshold && change.After > change.Before {
			maxedChanges = append(maxedChanges, change)
		}
	}

	switch len(maxedChanges) {
	case 0:
		return result, fmt.Errorf(
			"%d slider bytes changed but none reached the top of its range, so which one is %q is not established. Drag that one slider all the way to its maximum and save again",
			len(result.Changes), control.Label)
	case 1:
		// Isolated.
	default:
		offsets := make([]int, 0, len(maxedChanges))
		for _, change := range maxedChanges {
			offsets = append(offsets, change.Offset)
		}
		return result, fmt.Errorf(
			"%d bytes reached maximum (offsets %v), so %q cannot be pinned down. Start from the base preset again and move only that one slider",
			len(maxedChanges), offsets, control.Label)
	}

	winner := maxedChanges[0]
	if extra := len(result.Changes) - 1; extra > 0 {
		result.Warnings = append(result.Warnings, fmt.Sprintf(
			"%d other slider byte(s) also changed and were ignored. If %q comes out wrong, re-save with only that slider moved.",
			extra, control.Label))
	}

	result.Calibration = Calibration{
		ControlID:  control.ID,
		Offset:     winner.Offset,
		BaseValue:  winner.Before,
		MaxValue:   winner.After,
		ClassID:    int(base.Class()),
		RecordedAt: time.Now().UTC(),
		Evidence:   fmt.Sprintf("byte %d went %d→%d between %q and %q", winner.Offset, winner.Before, winner.After, baseName, maxedName),
	}
	return result, nil
}
