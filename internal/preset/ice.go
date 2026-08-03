package preset

import "encoding/binary"

var bdoPresetKey = [8]byte{0x51, 0xF3, 0x0F, 0x11, 0x04, 0x24, 0x6A, 0x00}

var iceModuli = [4][4]uint32{
	{333, 313, 505, 369}, {379, 375, 319, 391},
	{361, 445, 451, 397}, {397, 425, 395, 505},
}

var iceXors = [4][4]uint32{
	{0x83, 0x85, 0x9b, 0xcd}, {0xcc, 0xa7, 0xad, 0x41},
	{0x4b, 0x2e, 0xd4, 0x33}, {0xea, 0xcb, 0x2e, 0x04},
}

var icePermutation = [32]uint32{
	0x00000001, 0x00000080, 0x00000400, 0x00002000, 0x00080000, 0x00200000, 0x01000000, 0x40000000,
	0x00000008, 0x00000020, 0x00000100, 0x00004000, 0x00010000, 0x00800000, 0x04000000, 0x20000000,
	0x00000004, 0x00000010, 0x00000200, 0x00008000, 0x00020000, 0x00400000, 0x08000000, 0x10000000,
	0x00000002, 0x00000040, 0x00000800, 0x00001000, 0x00040000, 0x00100000, 0x02000000, 0x80000000,
}

var iceKeyRotation = [16]int{0, 1, 2, 3, 2, 1, 3, 0, 1, 3, 2, 0, 3, 1, 0, 2}

func galoisMultiply(left, right, modulus uint32) uint32 {
	var result uint32
	for right != 0 {
		if right&1 != 0 {
			result ^= left
		}
		left <<= 1
		right >>= 1
		if left >= 256 {
			left ^= modulus
		}
	}
	return result
}

func galoisPower7(value, modulus uint32) uint32 {
	if value == 0 {
		return 0
	}
	square := galoisMultiply(value, value, modulus)
	cube := galoisMultiply(value, square, modulus)
	sixth := galoisMultiply(cube, cube, modulus)
	return galoisMultiply(value, sixth, modulus)
}

func permute32(value uint32) uint32 {
	var result uint32
	for _, bit := range icePermutation {
		if value&1 != 0 {
			result |= bit
		}
		value >>= 1
	}
	return result
}

func buildIceSBoxes() [4096]uint32 {
	var boxes [4096]uint32
	for index := 0; index < 1024; index++ {
		column := uint32((index >> 1) & 0xFF)
		row := (index & 0x1) | ((index & 0x200) >> 8)
		boxes[index] = permute32(galoisPower7(column^iceXors[0][row], iceModuli[0][row]) << 24)
		boxes[1024+index] = permute32(galoisPower7(column^iceXors[1][row], iceModuli[1][row]) << 16)
		boxes[2048+index] = permute32(galoisPower7(column^iceXors[2][row], iceModuli[2][row]) << 8)
		boxes[3072+index] = permute32(galoisPower7(column^iceXors[3][row], iceModuli[3][row]))
	}
	return boxes
}

var iceSBoxes = buildIceSBoxes()

type iceCipher struct {
	rounds int
	keys   [][3]uint32
}

func newPresetCipher() *iceCipher {
	cipher := &iceCipher{rounds: 8, keys: make([][3]uint32, 8)}
	cipher.expandKey(bdoPresetKey)
	return cipher
}

func (cipher *iceCipher) expandKey(key [8]byte) {
	var kb [4]uint32
	for index := 0; index < 4; index++ {
		kb[3-index] = (uint32(key[index*2]) << 8) | uint32(key[index*2+1])
	}
	cipher.schedule(&kb, 0)
}

func (cipher *iceCipher) schedule(words *[4]uint32, start int) {
	for round := 0; round < 8; round++ {
		rotation := iceKeyRotation[round]
		key := &cipher.keys[start+round]
		key[0], key[1], key[2] = 0, 0, 0
		for segment := 0; segment < 5; segment++ {
			for lane := 0; lane < 3; lane++ {
				current := key[lane]
				for piece := 0; piece < 4; piece++ {
					word := (rotation + piece) & 3
					bit := words[word] & 1
					current = (current << 1) | bit
					words[word] = ((words[word] >> 1) | ((bit ^ 1) << 15)) & 0xFFFF
				}
				key[lane] = current
			}
		}
	}
}

func rotateLeft32(value uint32, count uint) uint32 {
	return (value << count) | (value >> (32 - count))
}

func feistel(value uint32, schedule *[3]uint32) uint32 {
	right := (value & 0x3FF) | ((value << 2) & 0xFFC00)
	left := ((value >> 16) & 0x3FF) | (rotateLeft32(value, 18) & 0xFFC00)
	salt := schedule[2] & (left ^ right)
	a := salt ^ left ^ schedule[0]
	b := salt ^ right ^ schedule[1]
	return iceSBoxes[(a>>10)&0x3FF] ^
		iceSBoxes[1024+(a&0x3FF)] ^
		iceSBoxes[2048+((b>>10)&0x3FF)] ^
		iceSBoxes[3072+(b&0x3FF)]
}

func (cipher *iceCipher) cryptBlock(left, right uint32, encrypt bool) (uint32, uint32) {
	if encrypt {
		for round := 0; round < cipher.rounds; round += 2 {
			left ^= feistel(right, &cipher.keys[round])
			right ^= feistel(left, &cipher.keys[round+1])
		}
	} else {
		for round := cipher.rounds - 2; round >= 0; round -= 2 {
			left ^= feistel(right, &cipher.keys[round+1])
			right ^= feistel(left, &cipher.keys[round])
		}
	}
	return left, right
}

func (cipher *iceCipher) cryptBlocks(buffer []byte, encrypt bool) {
	limit := len(buffer) - (len(buffer) % BlockSize)
	for offset := 0; offset < limit; offset += BlockSize {
		left := binary.BigEndian.Uint32(buffer[offset : offset+4])
		right := binary.BigEndian.Uint32(buffer[offset+4 : offset+8])
		left, right = cipher.cryptBlock(left, right, encrypt)
		binary.BigEndian.PutUint32(buffer[offset:offset+4], right)
		binary.BigEndian.PutUint32(buffer[offset+4:offset+8], left)
	}
}

func decryptPresetBlocks(raw []byte) []byte {
	plain := append([]byte(nil), raw...)
	newPresetCipher().cryptBlocks(plain[HeaderSize:], false)
	return plain
}

func encryptPresetBlocks(plain []byte) []byte {
	raw := append([]byte(nil), plain...)
	newPresetCipher().cryptBlocks(raw[HeaderSize:], true)
	return raw
}
