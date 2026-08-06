package preset

// A Control is one in-game slider that FaceForge can drive from a photo.
//
// The set below is deliberately small: there is exactly one control per facial
// proportion the bundled face landmarker can actually measure. Adding controls
// beyond that would mean inventing a target value for them, so we do not.
//
// Metric names must match the keys produced by web/js/face-analysis.js.
// Instruction is shown verbatim in the Learn panel, so it has to name a slider
// the user can actually find in Black Desert's creator.
type Control struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Metric      string `json:"metric"`
	Section     string `json:"section"`
	Instruction string `json:"instruction"`
	// Invert is true when a higher byte means a *smaller* measured feature.
	Invert bool `json:"invert"`
}

// Controls is the fixed catalogue of drivable sliders, in the order the Learn
// panel walks the user through them.
var Controls = []Control{
	{
		ID: "face_length", Label: "Face length", Metric: "faceAspect", Section: "Face Shape",
		Instruction: "Face Shape → drag the overall face length slider to its maximum (longest face).",
	},
	{
		ID: "cheek_width", Label: "Cheekbone width", Metric: "cheekWidth", Section: "Face Shape",
		Instruction: "Face Shape → cheekbones → drag width to its maximum (widest cheekbones).",
	},
	{
		ID: "jaw_width", Label: "Jaw width", Metric: "jawWidth", Section: "Face Shape",
		Instruction: "Face Shape → jaw → drag width to its maximum (widest jaw).",
	},
	{
		ID: "chin_length", Label: "Chin length", Metric: "lowerFace", Section: "Face Shape",
		Instruction: "Face Shape → chin → drag length to its maximum (longest chin).",
	},
	{
		ID: "forehead_height", Label: "Forehead height", Metric: "foreheadHeight", Section: "Face Shape",
		Instruction: "Face Shape → forehead → drag height to its maximum (tallest forehead).",
	},
	{
		ID: "eye_size", Label: "Eye size", Metric: "eyeOpenness", Section: "Eyes",
		Instruction: "Eyes → drag size to its maximum (largest eyes).",
	},
	{
		ID: "eye_spacing", Label: "Eye spacing", Metric: "eyeSpacing", Section: "Eyes",
		Instruction: "Eyes → drag the spacing/distance slider to its maximum (eyes furthest apart).",
	},
	{
		ID: "eye_angle", Label: "Eye angle", Metric: "eyeAngle", Section: "Eyes",
		Instruction: "Eyes → drag the angle/tilt slider to its maximum (outer corners highest).",
	},
	{
		ID: "brow_height", Label: "Eyebrow height", Metric: "browHeight", Section: "Eyebrows",
		Instruction: "Eyebrows → drag the height/position slider to its maximum (brows highest).",
	},
	{
		ID: "nose_width", Label: "Nose width", Metric: "noseWidth", Section: "Nose",
		Instruction: "Nose → drag width to its maximum (widest nose).",
	},
	{
		ID: "mouth_width", Label: "Mouth width", Metric: "mouthWidth", Section: "Mouth",
		Instruction: "Mouth → drag width to its maximum (widest mouth).",
	},
	{
		ID: "lip_thickness", Label: "Lip thickness", Metric: "lipThickness", Section: "Mouth",
		Instruction: "Mouth → drag lip thickness/volume to its maximum (fullest lips).",
	},
}

// ControlByID looks up a control in the catalogue.
func ControlByID(id string) (Control, bool) {
	for _, control := range Controls {
		if control.ID == id {
			return control, true
		}
	}
	return Control{}, false
}

// Metrics lists every measurement the controls consume, so the UI can check
// that the analyzer produced all of them.
func Metrics() []string {
	seen := make(map[string]struct{}, len(Controls))
	names := make([]string, 0, len(Controls))
	for _, control := range Controls {
		if _, exists := seen[control.Metric]; exists {
			continue
		}
		seen[control.Metric] = struct{}{}
		names = append(names, control.Metric)
	}
	return names
}
