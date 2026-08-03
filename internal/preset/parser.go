package preset

import (
	"encoding/binary"
	"fmt"
)

func Parse(data []byte) (*Preset, error) {
	if len(data) != ExpectedSizeV20 {
		return nil, fmt.Errorf("invalid BDO preset size: got %d bytes, expected %d bytes for version %d", len(data), ExpectedSizeV20, SupportedVersion)
	}

	version := binary.LittleEndian.Uint32(data[:HeaderSize])
	if version != SupportedVersion {
		return nil, fmt.Errorf("unsupported BDO preset version %d; FaceForge BDO currently supports version %d", version, SupportedVersion)
	}

	raw := append([]byte(nil), data...)
	plain := decryptPresetBlocks(raw)
	blocks := make([][BlockSize]byte, BlockCountV20)
	plainBlocks := make([][BlockSize]byte, BlockCountV20)
	for index := range blocks {
		start := HeaderSize + index*BlockSize
		copy(blocks[index][:], raw[start:start+BlockSize])
		copy(plainBlocks[index][:], plain[start:start+BlockSize])
	}

	return &Preset{version: version, raw: raw, blocks: blocks, plain: plain, plainBlocks: plainBlocks}, nil
}

func ParsePlain(data []byte) (*Preset, error) {
	if len(data) != ExpectedSizeV20 {
		return nil, fmt.Errorf("invalid BDO preset size: got %d bytes, expected %d bytes for version %d", len(data), ExpectedSizeV20, SupportedVersion)
	}
	version := binary.LittleEndian.Uint32(data[:HeaderSize])
	if version != SupportedVersion {
		return nil, fmt.Errorf("unsupported BDO preset version %d; FaceForge BDO currently supports version %d", version, SupportedVersion)
	}
	return Parse(encryptPresetBlocks(data))
}

func (p *Preset) Block(index int) ([BlockSize]byte, error) {
	if p == nil {
		return [BlockSize]byte{}, fmt.Errorf("preset is nil")
	}
	if index < 0 || index >= len(p.blocks) {
		return [BlockSize]byte{}, fmt.Errorf("block index %d is out of range 0..%d", index, len(p.blocks)-1)
	}
	return p.blocks[index], nil
}

func (p *Preset) PlainBlock(index int) ([BlockSize]byte, error) {
	if p == nil {
		return [BlockSize]byte{}, fmt.Errorf("preset is nil")
	}
	if index < 0 || index >= len(p.plainBlocks) {
		return [BlockSize]byte{}, fmt.Errorf("plain block index %d is out of range 0..%d", index, len(p.plainBlocks)-1)
	}
	return p.plainBlocks[index], nil
}
