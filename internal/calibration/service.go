package calibration

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
)

func Observe(before, after *preset.Preset, label string) (Observation, error) {
	label = strings.TrimSpace(label)
	if before == nil || after == nil {
		return Observation{}, fmt.Errorf("before and after presets are required")
	}
	if label == "" {
		return Observation{}, fmt.Errorf("calibration label is required")
	}
	if before.Version() != after.Version() {
		return Observation{}, fmt.Errorf("preset versions differ: %d and %d", before.Version(), after.Version())
	}

	comparison, err := preset.Compare(before, after)
	if err != nil {
		return Observation{}, err
	}
	return Observation{
		Label:         label,
		PresetVersion: before.Version(),
		BeforeSHA256:  before.SHA256(),
		AfterSHA256:   after.SHA256(),
		ChangedBlocks: append([]int(nil), comparison.ChangedBlocks...),
		ObservedAt:    time.Now().UTC().Truncate(time.Second),
	}, nil
}

func (db *Database) Merge(observation Observation, mode MergeMode) error {
	if db == nil {
		return fmt.Errorf("calibration database is nil")
	}
	if db.FormatVersion == 0 {
		db.FormatVersion = 1
	}
	if db.Mappings == nil {
		db.Mappings = make(map[string]Mapping)
	}
	if observation.PresetVersion != db.PresetVersion {
		return fmt.Errorf("observation preset version %d does not match database version %d", observation.PresetVersion, db.PresetVersion)
	}
	if mode != MergeUnion && mode != MergeIntersection {
		return fmt.Errorf("unsupported calibration merge mode %q", mode)
	}

	key := normalizeLabel(observation.Label)
	if key == "" {
		return fmt.Errorf("observation label is required")
	}
	incoming := sortedUnique(observation.ChangedBlocks)
	now := observation.ObservedAt
	if now.IsZero() {
		now = time.Now().UTC().Truncate(time.Second)
	}

	existing, found := db.Mappings[key]
	if !found {
		db.Mappings[key] = Mapping{
			Label:        strings.TrimSpace(observation.Label),
			Blocks:       incoming,
			Observations: 1,
			UpdatedAt:    now,
		}
		return nil
	}

	switch mode {
	case MergeUnion:
		existing.Blocks = union(existing.Blocks, incoming)
	case MergeIntersection:
		existing.Blocks = intersection(existing.Blocks, incoming)
	}
	existing.Observations++
	existing.UpdatedAt = now
	db.Mappings[key] = existing
	return nil
}

func normalizeLabel(label string) string {
	return strings.ToLower(strings.Join(strings.Fields(label), " "))
}

func sortedUnique(values []int) []int {
	seen := make(map[int]struct{}, len(values))
	result := make([]int, 0, len(values))
	for _, value := range values {
		if value < 0 || value >= preset.BlockCountV20 {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Ints(result)
	return result
}

func union(a, b []int) []int {
	return sortedUnique(append(append([]int(nil), a...), b...))
}

func intersection(a, b []int) []int {
	right := make(map[int]struct{}, len(b))
	for _, value := range b {
		right[value] = struct{}{}
	}
	result := make([]int, 0)
	for _, value := range a {
		if _, exists := right[value]; exists {
			result = append(result, value)
		}
	}
	return sortedUnique(result)
}
