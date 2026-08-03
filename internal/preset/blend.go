package preset

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

type GroupBlend struct {
	GroupID string  `json:"groupId"`
	DonorID string  `json:"donorId"`
	Weight  float64 `json:"weight"`
}

type Recipe struct {
	Name            string       `json:"name,omitempty"`
	Seed            string       `json:"seed,omitempty"`
	AllowCrossClass bool         `json:"allowCrossClass"`
	AllowProtected  bool         `json:"allowProtected"`
	Groups          []GroupBlend `json:"groups"`
}

type BlendResult struct {
	Preset        *Preset           `json:"-"`
	ChangedBlocks []int             `json:"changedBlocks"`
	ChangedBytes  int               `json:"changedBytes"`
	Provenance    map[int]string    `json:"provenance"`
	Warnings      []string          `json:"warnings,omitempty"`
	Recipe        Recipe            `json:"recipe"`
	BaseSHA256    string            `json:"baseSha256"`
	DonorSHA256   map[string]string `json:"donorSha256"`
}

func Blend(base *Preset, donors map[string]*Preset, recipe Recipe, schema Schema) (*BlendResult, error) {
	if base == nil {
		return nil, fmt.Errorf("base preset is required")
	}
	if err := schema.Validate(); err != nil {
		return nil, fmt.Errorf("invalid schema: %w", err)
	}
	if base.Version() != schema.Version || base.BlockCount() != schema.BlockCount {
		return nil, fmt.Errorf("base preset does not match schema version %d", schema.Version)
	}

	baseClass, _ := base.Block(ClassBlockIndex)
	donorHashes := make(map[string]string, len(donors))
	for id, donor := range donors {
		if strings.TrimSpace(id) == "" || donor == nil {
			return nil, fmt.Errorf("every donor must have a non-empty id and preset")
		}
		if donor.Version() != base.Version() || donor.BlockCount() != base.BlockCount() {
			return nil, fmt.Errorf("donor %q is incompatible with the base preset", id)
		}
		donorClass, _ := donor.Block(ClassBlockIndex)
		if donorClass != baseClass && !recipe.AllowCrossClass {
			return nil, fmt.Errorf("donor %q belongs to another class; enable experimental cross-class blending to continue", id)
		}
		donorHashes[id] = donor.SHA256()
	}

	outputPlain := base.PlainBytes()
	provenance := make(map[int]string)
	warnings := make([]string, 0)
	usedGroups := make(map[string]struct{}, len(recipe.Groups))
	changedBlocks := make(map[int]struct{})

	for _, instruction := range recipe.Groups {
		if _, duplicate := usedGroups[instruction.GroupID]; duplicate {
			return nil, fmt.Errorf("feature group %q appears more than once in the recipe", instruction.GroupID)
		}
		usedGroups[instruction.GroupID] = struct{}{}

		group, found := schema.Group(instruction.GroupID)
		if !found {
			return nil, fmt.Errorf("unknown feature group %q", instruction.GroupID)
		}
		donor, found := donors[instruction.DonorID]
		if !found {
			return nil, fmt.Errorf("unknown donor %q", instruction.DonorID)
		}
		if math.IsNaN(instruction.Weight) || instruction.Weight < 0 || instruction.Weight > 100 {
			return nil, fmt.Errorf("weight for group %q must be between 0 and 100", instruction.GroupID)
		}
		if group.Protected && !recipe.AllowProtected {
			warnings = append(warnings, fmt.Sprintf("Protected group %q was preserved from the base preset.", group.Name))
			continue
		}
		if instruction.Weight <= 0 {
			continue
		}

		for _, index := range group.BlockIndices() {
			baseBlock, _ := base.PlainBlock(index)
			donorBlock, _ := donor.PlainBlock(index)
			blendedBlock := blendPlainBlock(baseBlock, donorBlock, instruction.Weight)
			start := HeaderSize + index*BlockSize
			copy(outputPlain[start:start+BlockSize], blendedBlock[:])
			if blendedBlock != baseBlock {
				provenance[index] = instruction.DonorID
				changedBlocks[index] = struct{}{}
			}
		}
	}

	blended, err := ParsePlain(outputPlain)
	if err != nil {
		return nil, fmt.Errorf("generated preset failed validation: %w", err)
	}
	if !recipe.AllowProtected {
		generatedClass, _ := blended.Block(ClassBlockIndex)
		if generatedClass != baseClass {
			return nil, fmt.Errorf("generated preset changed the protected class identity block")
		}
	}

	comparison, err := Compare(base, blended)
	if err != nil {
		return nil, err
	}
	plainByteChanges, err := countPlainByteChanges(base, blended)
	if err != nil {
		return nil, err
	}
	return &BlendResult{
		Preset:        blended,
		ChangedBlocks: comparison.ChangedBlocks,
		ChangedBytes:  plainByteChanges,
		Provenance:    provenance,
		Warnings:      dedupeWarnings(warnings),
		Recipe:        recipe,
		BaseSHA256:    base.SHA256(),
		DonorSHA256:   donorHashes,
	}, nil
}

func blendPlainBlock(base, donor [BlockSize]byte, weight float64) [BlockSize]byte {
	if weight <= 0 {
		return base
	}
	if weight >= 100 {
		return donor
	}

	result := base
	changed := false
	fallbackIndex := -1
	fallbackDelta := -1
	for index := 0; index < BlockSize; index++ {
		if base[index] == donor[index] {
			continue
		}
		delta := absInt(int(donor[index]) - int(base[index]))
		if delta > fallbackDelta {
			fallbackDelta = delta
			fallbackIndex = index
		}
		result[index] = blendByte(base[index], donor[index], weight)
		if result[index] != base[index] {
			changed = true
		}
	}

	if !changed && fallbackIndex >= 0 {
		result[fallbackIndex] = nudgeToward(base[fallbackIndex], donor[fallbackIndex])
	}
	return result
}

func blendByte(base, donor byte, weight float64) byte {
	if base == donor {
		return base
	}
	if weight <= 0 {
		return base
	}
	if weight >= 100 {
		return donor
	}

	baseInt := int(base)
	donorInt := int(donor)
	delta := absInt(donorInt - baseInt)
	bothPercentLike := baseInt <= 100 && donorInt <= 100
	linearFriendly := bothPercentLike || delta <= 12 || (baseInt == 0 && donorInt <= 100) || (donorInt == 0 && baseInt <= 100)
	if linearFriendly {
		mixed := float64(baseInt) + (float64(donorInt-baseInt) * weight / 100.0)
		value := int(math.Round(mixed))
		if value < 0 {
			value = 0
		}
		if value > 255 {
			value = 255
		}
		return byte(value)
	}

	if weight < 50 {
		return base
	}
	return donor
}

func nudgeToward(base, donor byte) byte {
	if base == donor {
		return base
	}
	if base < donor {
		return base + 1
	}
	return base - 1
}

func countPlainByteChanges(left, right *Preset) (int, error) {
	if left == nil || right == nil {
		return 0, fmt.Errorf("both presets are required")
	}
	if left.Version() != right.Version() || left.BlockCount() != right.BlockCount() {
		return 0, fmt.Errorf("preset versions differ")
	}
	plainLeft := left.PlainBytes()
	plainRight := right.PlainBytes()
	count := 0
	for index := HeaderSize; index < len(plainLeft) && index < len(plainRight); index++ {
		if plainLeft[index] != plainRight[index] {
			count++
		}
	}
	return count, nil
}

func dedupeWarnings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func (result BlendResult) MarshalJSON() ([]byte, error) {
	type alias BlendResult
	return json.Marshal(alias(result))
}
