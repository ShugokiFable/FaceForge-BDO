package preset

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// A Calibration records where one Control lives in the record. It is produced by
// Learn from two real presets the user saved from the game, never by inference.
type Calibration struct {
	ControlID  string    `json:"controlId"`
	Offset     int       `json:"offset"`
	BaseValue  int       `json:"baseValue"`
	MaxValue   int       `json:"maxValue"`
	ClassID    int       `json:"classId"`
	RecordedAt time.Time `json:"recordedAt"`
	Evidence   string    `json:"evidence"`
}

// SliderMap is the persisted set of calibrations.
type SliderMap struct {
	Version      int           `json:"version"`
	Calibrations []Calibration `json:"calibrations"`
}

// Find returns the calibration for a control id.
func (m SliderMap) Find(controlID string) (Calibration, bool) {
	for _, calibration := range m.Calibrations {
		if calibration.ControlID == controlID {
			return calibration, true
		}
	}
	return Calibration{}, false
}

// Upsert replaces any existing calibration for the same control.
func (m *SliderMap) Upsert(calibration Calibration) {
	for index, existing := range m.Calibrations {
		if existing.ControlID == calibration.ControlID {
			m.Calibrations[index] = calibration
			return
		}
	}
	m.Calibrations = append(m.Calibrations, calibration)
	sort.Slice(m.Calibrations, func(i, j int) bool {
		return m.Calibrations[i].Offset < m.Calibrations[j].Offset
	})
}

// Remove drops a calibration.
func (m *SliderMap) Remove(controlID string) bool {
	for index, existing := range m.Calibrations {
		if existing.ControlID == controlID {
			m.Calibrations = append(m.Calibrations[:index], m.Calibrations[index+1:]...)
			return true
		}
	}
	return false
}

// Validate rejects a map that would write outside the slider region or that
// points two controls at the same byte.
func (m SliderMap) Validate() error {
	used := make(map[int]string, len(m.Calibrations))
	for _, calibration := range m.Calibrations {
		if _, known := ControlByID(calibration.ControlID); !known {
			return fmt.Errorf("unknown control %q", calibration.ControlID)
		}
		if !IsSlider(calibration.Offset) {
			return fmt.Errorf("control %q offset %d is not a writable slider byte (region %d..%d, excluding %v)",
				calibration.ControlID, calibration.Offset, SliderFirst, SliderLast, UnclassifiedOffsets())
		}
		if owner, clash := used[calibration.Offset]; clash {
			return fmt.Errorf("offset %d is claimed by both %q and %q", calibration.Offset, owner, calibration.ControlID)
		}
		used[calibration.Offset] = calibration.ControlID
	}
	return nil
}

// LoadSliderMap reads the map, returning an empty one when the file is absent.
func LoadSliderMap(path string) (SliderMap, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return SliderMap{Version: 1, Calibrations: []Calibration{}}, nil
		}
		return SliderMap{}, fmt.Errorf("read slider map: %w", err)
	}
	var loaded SliderMap
	if err := json.Unmarshal(data, &loaded); err != nil {
		return SliderMap{}, fmt.Errorf("parse slider map: %w", err)
	}
	if loaded.Version == 0 {
		loaded.Version = 1
	}
	if err := loaded.Validate(); err != nil {
		return SliderMap{}, fmt.Errorf("slider map is not usable: %w", err)
	}
	return loaded, nil
}

// SaveSliderMap writes the map atomically.
func SaveSliderMap(path string, value SliderMap) error {
	if err := value.Validate(); err != nil {
		return err
	}
	if value.Version == 0 {
		value.Version = 1
	}
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode slider map: %w", err)
	}
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create slider map directory: %w", err)
	}
	temp, err := os.CreateTemp(directory, ".slidermap-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary slider map: %w", err)
	}
	tempPath := temp.Name()
	defer func() {
		_ = temp.Close()
		_ = os.Remove(tempPath)
	}()
	if _, err := temp.Write(encoded); err != nil {
		return fmt.Errorf("write temporary slider map: %w", err)
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("flush temporary slider map: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close temporary slider map: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("install slider map: %w", err)
	}
	return nil
}
