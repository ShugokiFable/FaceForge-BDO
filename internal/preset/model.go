package preset

const (
	SupportedVersion   uint32 = 20
	HeaderSize                = 4
	BlockSize                 = 8
	BlockCountV20             = 115
	ExpectedSizeV20           = HeaderSize + BlockSize*BlockCountV20
	ClassBlockIndex           = 9
	FaceTypeBlockIndex        = 10
)

var DefaultCipherBlock = [BlockSize]byte{0x41, 0xef, 0x58, 0x6a, 0xf7, 0xca, 0x4f, 0x0e}

type Preset struct {
	version uint32
	raw     []byte
	blocks  [][BlockSize]byte
}

func (p *Preset) Version() uint32 {
	if p == nil {
		return 0
	}
	return p.version
}

func (p *Preset) BlockCount() int {
	if p == nil {
		return 0
	}
	return len(p.blocks)
}

func (p *Preset) Bytes() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.raw...)
}
