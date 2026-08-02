package calibration

import "time"

type MergeMode string

const (
	MergeUnion        MergeMode = "union"
	MergeIntersection MergeMode = "intersection"
)

type Observation struct {
	Label         string    `json:"label"`
	PresetVersion uint32    `json:"presetVersion"`
	BeforeSHA256  string    `json:"beforeSha256"`
	AfterSHA256   string    `json:"afterSha256"`
	ChangedBlocks []int     `json:"changedBlocks"`
	ObservedAt    time.Time `json:"observedAt"`
}

type Mapping struct {
	Label        string    `json:"label"`
	Blocks       []int     `json:"blocks"`
	Observations int       `json:"observations"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type Database struct {
	FormatVersion int                `json:"formatVersion"`
	PresetVersion uint32             `json:"presetVersion"`
	Mappings      map[string]Mapping `json:"mappings"`
}

func NewDatabase(presetVersion uint32) *Database {
	return &Database{
		FormatVersion: 1,
		PresetVersion: presetVersion,
		Mappings:      make(map[string]Mapping),
	}
}
