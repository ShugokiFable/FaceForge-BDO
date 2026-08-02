package preset

import (
	"fmt"
	"sort"
)

type BlockRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

func (r BlockRange) BlockIndices() []int {
	if r.End < r.Start {
		return nil
	}
	indices := make([]int, 0, r.End-r.Start+1)
	for index := r.Start; index <= r.End; index++ {
		indices = append(indices, index)
	}
	return indices
}

type FeatureGroup struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description,omitempty"`
	Confidence  string       `json:"confidence,omitempty"`
	Protected   bool         `json:"protected"`
	Ranges      []BlockRange `json:"ranges"`
}

func (g FeatureGroup) BlockIndices() []int {
	indices := make([]int, 0)
	for _, blockRange := range g.Ranges {
		indices = append(indices, blockRange.BlockIndices()...)
	}
	sort.Ints(indices)
	return indices
}

type Schema struct {
	Name       string         `json:"name"`
	Version    uint32         `json:"version"`
	BlockSize  int            `json:"blockSize"`
	BlockCount int            `json:"blockCount"`
	Groups     []FeatureGroup `json:"groups"`
}

func (s Schema) Validate() error {
	if s.Version != SupportedVersion {
		return fmt.Errorf("schema version %d does not match supported preset version %d", s.Version, SupportedVersion)
	}
	if s.BlockSize != BlockSize {
		return fmt.Errorf("schema block size %d does not match %d", s.BlockSize, BlockSize)
	}
	if s.BlockCount != BlockCountV20 {
		return fmt.Errorf("schema block count %d does not match %d", s.BlockCount, BlockCountV20)
	}
	if len(s.Groups) == 0 {
		return fmt.Errorf("schema contains no feature groups")
	}

	ids := make(map[string]struct{}, len(s.Groups))
	occupied := make(map[int]string, s.BlockCount)
	for _, group := range s.Groups {
		if group.ID == "" {
			return fmt.Errorf("schema contains a feature group with an empty id")
		}
		if _, exists := ids[group.ID]; exists {
			return fmt.Errorf("duplicate feature group id %q", group.ID)
		}
		ids[group.ID] = struct{}{}
		if len(group.Ranges) == 0 {
			return fmt.Errorf("feature group %q has no block ranges", group.ID)
		}
		for _, blockRange := range group.Ranges {
			if blockRange.Start < 0 || blockRange.End < blockRange.Start || blockRange.End >= s.BlockCount {
				return fmt.Errorf("feature group %q has invalid block range %d..%d", group.ID, blockRange.Start, blockRange.End)
			}
			for _, index := range blockRange.BlockIndices() {
				if owner, exists := occupied[index]; exists {
					return fmt.Errorf("block %d is assigned to both %q and %q", index, owner, group.ID)
				}
				occupied[index] = group.ID
			}
		}
	}
	return nil
}

func (s Schema) Group(id string) (FeatureGroup, bool) {
	for _, group := range s.Groups {
		if group.ID == id {
			return group, true
		}
	}
	return FeatureGroup{}, false
}

func (s Schema) AllBlockIndices() []int {
	indices := make([]int, 0, s.BlockCount)
	seen := make(map[int]struct{}, s.BlockCount)
	for _, group := range s.Groups {
		for _, index := range group.BlockIndices() {
			if _, exists := seen[index]; exists {
				continue
			}
			seen[index] = struct{}{}
			indices = append(indices, index)
		}
	}
	sort.Ints(indices)
	return indices
}
