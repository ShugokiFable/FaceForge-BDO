package preset

import (
	"encoding/binary"
	"fmt"
	"unicode/utf16"
)

// Parse reads an on-disk (encrypted) customization file.
func Parse(data []byte) (*Preset, error) {
	if len(data) != ExpectedSizeV20 {
		return nil, fmt.Errorf("invalid BDO preset size: got %d bytes, expected %d bytes for version %d", len(data), ExpectedSizeV20, SupportedVersion)
	}
	version := binary.LittleEndian.Uint32(data[:HeaderSize])
	if version != SupportedVersion {
		return nil, fmt.Errorf("unsupported BDO preset version %d; FaceForge BDO supports version %d", version, SupportedVersion)
	}
	raw := append([]byte(nil), data...)
	return &Preset{version: version, raw: raw, plain: decryptPresetBlocks(raw)}, nil
}

// FromPlain encrypts an edited plaintext body and re-parses the result, so a
// generated preset is always validated exactly like a file read from disk.
func FromPlain(plain []byte) (*Preset, error) {
	if len(plain) != ExpectedSizeV20 {
		return nil, fmt.Errorf("invalid plaintext size: got %d bytes, expected %d", len(plain), ExpectedSizeV20)
	}
	if version := binary.LittleEndian.Uint32(plain[:HeaderSize]); version != SupportedVersion {
		return nil, fmt.Errorf("refusing to build preset with version %d", version)
	}
	return Parse(encryptPresetBlocks(plain))
}

// SetName writes the character name into a plaintext body. Only the name field
// itself is touched; the reserved bytes that follow it are left exactly as the
// base preset had them, because their meaning is not established.
func SetName(plain []byte, name string) error {
	if len(plain) < NameOffset+NameMaxBytes {
		return fmt.Errorf("plaintext too short to hold a name")
	}
	units := utf16.Encode([]rune(name))
	if len(units)*2 > NameMaxBytes {
		return fmt.Errorf("name is too long: %d characters exceeds the %d the format holds", len(units), NameMaxBytes/2)
	}
	field := plain[NameOffset : NameOffset+NameMaxBytes]
	for index := range field {
		field[index] = 0
	}
	for index, unit := range units {
		binary.LittleEndian.PutUint16(field[index*2:index*2+2], unit)
	}
	return nil
}
