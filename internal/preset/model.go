package preset

import (
	"encoding/binary"
	"fmt"
	"unicode/utf16"
)

// The verified plaintext layout of a Black Desert customization v20 record.
//
// Every constant below is measured, not assumed. It was derived by decrypting a
// corpus of 134 real customization files (124 Beauty Album downloads whose
// filenames carry the class id as a prefix, 6 player saves, 4 research samples)
// and profiling every byte offset across the whole corpus. See LAYOUT.md.
//
// BlockSize is the ICE cipher's block size. It is an artifact of the encryption,
// NOT a unit of the data: a single 8-byte block spans eight unrelated sliders.
// Nothing outside ice.go should reason in blocks.
const (
	SupportedVersion uint32 = 20
	HeaderSize              = 4 // version, little-endian, outside the ciphertext
	BlockSize               = 8 // ICE block size (cipher artifact only)
	ExpectedSizeV20         = 924

	// NameOffset..NameOffset+NameMaxBytes is the character name, UTF-16LE,
	// NUL-padded. Offsets 40..69 are zero in all 134 corpus files.
	NameOffset   = 8
	NameMaxBytes = 32 // 16 UTF-16 code units, BDO's name limit

	// ClassOffset holds the class id. Confirmed: this byte equals the class
	// prefix of the filename in all 124 prefixed corpus files, across 12
	// distinct classes.
	ClassOffset = 80

	// SliderFirst..SliderLast is the face and body slider region. Bytes 221..232
	// are zero in every corpus file and separate it from the wide-valued style,
	// colour, hair and makeup data that follows.
	//
	// Every byte in this span stays within 0..100 across the whole corpus except
	// the three in unclassifiedOffsets, and the value 100 is observed at 88 of
	// them, which is what identifies them as 0..100 sliders.
	SliderFirst = 98
	SliderLast  = 220
)

// unclassifiedOffsets are bytes inside the slider region that reach 254, so they
// are not 0..100 sliders. Their stride of 3 suggests a packed triple, but nothing
// in the corpus establishes what they mean, so FaceForge never writes them: they
// are copied from the base preset untouched.
var unclassifiedOffsets = map[int]struct{}{106: {}, 109: {}, 112: {}}

// IsSlider reports whether an offset is a byte FaceForge is willing to write.
func IsSlider(offset int) bool {
	if offset < SliderFirst || offset > SliderLast {
		return false
	}
	_, unclassified := unclassifiedOffsets[offset]
	return !unclassified
}

// UnclassifiedOffsets lists the untouched bytes inside the slider region.
func UnclassifiedOffsets() []int {
	offsets := make([]int, 0, len(unclassifiedOffsets))
	for offset := SliderFirst; offset <= SliderLast; offset++ {
		if _, unclassified := unclassifiedOffsets[offset]; unclassified {
			offsets = append(offsets, offset)
		}
	}
	return offsets
}

// DefaultCipherBlock is the ciphertext of eight zero bytes under the preset key.
// Kept only so the laboratory can still flag untouched regions.
var DefaultCipherBlock = [BlockSize]byte{0x41, 0xef, 0x58, 0x6a, 0xf7, 0xca, 0x4f, 0x0e}

// Preset is a parsed customization record. plain is the decrypted body; raw is
// the on-disk form. The two are kept in sync by Rebuild.
type Preset struct {
	version uint32
	raw     []byte
	plain   []byte
}

func (p *Preset) Version() uint32 {
	if p == nil {
		return 0
	}
	return p.version
}

// Bytes returns the encrypted, on-disk form.
func (p *Preset) Bytes() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.raw...)
}

// PlainBytes returns the decrypted body.
func (p *Preset) PlainBytes() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.plain...)
}

// Class returns the class id byte.
func (p *Preset) Class() byte {
	if p == nil || len(p.plain) <= ClassOffset {
		return 0
	}
	return p.plain[ClassOffset]
}

// Name decodes the character name the preset was saved under.
func (p *Preset) Name() string {
	if p == nil || len(p.plain) < NameOffset+NameMaxBytes {
		return ""
	}
	units := make([]uint16, 0, NameMaxBytes/2)
	for offset := NameOffset; offset < NameOffset+NameMaxBytes; offset += 2 {
		unit := binary.LittleEndian.Uint16(p.plain[offset : offset+2])
		if unit == 0 {
			break
		}
		units = append(units, unit)
	}
	return string(utf16.Decode(units))
}

// Slider reads one writable byte of the face and body slider region.
func (p *Preset) Slider(offset int) (byte, error) {
	if p == nil {
		return 0, fmt.Errorf("preset is nil")
	}
	if !IsSlider(offset) {
		return 0, fmt.Errorf("offset %d is not a writable slider byte (region %d..%d, excluding %v)",
			offset, SliderFirst, SliderLast, UnclassifiedOffsets())
	}
	return p.plain[offset], nil
}

// Byte reads any plaintext byte. Used by the learn diff and the laboratory.
func (p *Preset) Byte(offset int) (byte, error) {
	if p == nil {
		return 0, fmt.Errorf("preset is nil")
	}
	if offset < 0 || offset >= len(p.plain) {
		return 0, fmt.Errorf("offset %d is out of range 0..%d", offset, len(p.plain)-1)
	}
	return p.plain[offset], nil
}

// Edit returns a mutable copy of the plaintext for callers that build a new
// preset. Feed the result back through FromPlain to re-encrypt and validate.
func (p *Preset) Edit() []byte {
	return p.PlainBytes()
}
