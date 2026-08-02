package preset

import (
	"crypto/sha256"
	"encoding/hex"
)

func (p *Preset) SHA256() string {
	if p == nil {
		return ""
	}
	sum := sha256.Sum256(p.raw)
	return hex.EncodeToString(sum[:])
}
