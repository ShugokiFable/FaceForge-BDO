package preset

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
	"sort"
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
	Provenance    map[int]string    `json:"provenance"`
	Warnings      []string          `json:"warnings,omitempty"`
	Recipe        Recipe            `json:"recipe"`
	BaseSHA256    string            `json:"baseSha256"`
	DonorSHA256   map[string]string `json:"donorSha256"`
}

type rankedBlock struct {
	index int
	rank  uint64
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

	output := base.Bytes()
	provenance := make(map[int]string)
	warnings := make([]string, 0)
	usedGroups := make(map[string]struct{}, len(recipe.Groups))

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

		indices := group.BlockIndices()
		selected := selectWeightedBlocks(indices, instruction.Weight, recipe.Seed, group.ID, base.SHA256(), donor.SHA256())
		for _, index := range selected {
			block, _ := donor.Block(index)
			start := HeaderSize + index*BlockSize
			copy(output[start:start+BlockSize], block[:])
			provenance[index] = instruction.DonorID
		}
	}

	blended, err := Parse(output)
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
	return &BlendResult{
		Preset:        blended,
		ChangedBlocks: comparison.ChangedBlocks,
		Provenance:    provenance,
		Warnings:      warnings,
		Recipe:        recipe,
		BaseSHA256:    base.SHA256(),
		DonorSHA256:   donorHashes,
	}, nil
}

func selectWeightedBlocks(indices []int, weight float64, seed, groupID, baseHash, donorHash string) []int {
	if len(indices) == 0 || weight <= 0 {
		return nil
	}
	if weight >= 100 {
		return append([]int(nil), indices...)
	}

	count := int(math.Floor(float64(len(indices))*weight/100 + 0.5))
	ranked := make([]rankedBlock, 0, len(indices))
	for _, index := range indices {
		material := fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%d", seed, groupID, baseHash, donorHash, index)
		sum := sha256.Sum256([]byte(material))
		ranked = append(ranked, rankedBlock{index: index, rank: binary.BigEndian.Uint64(sum[:8])})
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].rank == ranked[j].rank {
			return ranked[i].index < ranked[j].index
		}
		return ranked[i].rank < ranked[j].rank
	})
	selected := make([]int, 0, count)
	for _, candidate := range ranked[:count] {
		selected = append(selected, candidate.index)
	}
	sort.Ints(selected)
	return selected
}
