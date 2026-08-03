package preset

import "fmt"

type BlockRun struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

type Comparison struct {
	Version       uint32     `json:"version"`
	ChangedBlocks []int      `json:"changedBlocks"`
	SameBlocks    []int      `json:"sameBlocks"`
	Runs          []BlockRun `json:"runs"`
}

func Compare(a, b *Preset) (Comparison, error) {
	if a == nil || b == nil {
		return Comparison{}, fmt.Errorf("both presets are required")
	}
	if a.Version() != b.Version() {
		return Comparison{}, fmt.Errorf("preset versions differ: %d and %d", a.Version(), b.Version())
	}
	if a.BlockCount() != b.BlockCount() {
		return Comparison{}, fmt.Errorf("preset block counts differ: %d and %d", a.BlockCount(), b.BlockCount())
	}

	result := Comparison{Version: a.Version(), ChangedBlocks: []int{}, SameBlocks: []int{}, Runs: []BlockRun{}}
	for index := 0; index < a.BlockCount(); index++ {
		left, _ := a.Block(index)
		right, _ := b.Block(index)
		if left == right {
			result.SameBlocks = append(result.SameBlocks, index)
		} else {
			result.ChangedBlocks = append(result.ChangedBlocks, index)
		}
	}
	if len(result.ChangedBlocks) > 0 {
		start := result.ChangedBlocks[0]
		previous := start
		for _, index := range result.ChangedBlocks[1:] {
			if index == previous+1 {
				previous = index
				continue
			}
			result.Runs = append(result.Runs, BlockRun{Start: start, End: previous})
			start, previous = index, index
		}
		result.Runs = append(result.Runs, BlockRun{Start: start, End: previous})
	}
	return result, nil
}
