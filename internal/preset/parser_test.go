package preset

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func loadFixture(t *testing.T, name string) []byte {
	t.Helper()
	path := filepath.Join("..", "..", "testdata", "presets", name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %q: %v", name, err)
	}
	return data
}

func TestParseVersion20PresetAndRoundTrip(t *testing.T) {
	original := loadFixture(t, "Cute Lahn")

	parsed, err := Parse(original)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if got, want := parsed.Version(), uint32(20); got != want {
		t.Fatalf("Version() = %d, want %d", got, want)
	}
	if got, want := parsed.BlockCount(), 115; got != want {
		t.Fatalf("BlockCount() = %d, want %d", got, want)
	}
	if !bytes.Equal(parsed.Bytes(), original) {
		t.Fatal("Bytes() did not preserve the preset exactly")
	}

	// Prove the parser owns its data instead of retaining the caller's mutable slice.
	original[4] ^= 0xff
	if bytes.Equal(parsed.Bytes(), original) {
		t.Fatal("parsed preset changed when the caller mutated the source slice")
	}
}

func TestParseRejectsInvalidLength(t *testing.T) {
	data := loadFixture(t, "Cute Lahn")

	_, err := Parse(data[:len(data)-1])
	if err == nil || !strings.Contains(err.Error(), "924") {
		t.Fatalf("Parse short file error = %v, want expected-size message", err)
	}
}

func TestParseRejectsUnsupportedVersion(t *testing.T) {
	data := append([]byte(nil), loadFixture(t, "Cute Lahn")...)
	data[0] = 19

	_, err := Parse(data)
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "version") {
		t.Fatalf("Parse unsupported version error = %v, want version message", err)
	}
}

func TestBlockReturnsExactCipherBlock(t *testing.T) {
	parsed, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}

	block, err := parsed.Block(9)
	if err != nil {
		t.Fatal(err)
	}
	want := [8]byte{0x10, 0x95, 0xd5, 0x06, 0x7c, 0x48, 0x5f, 0xc5}
	if block != want {
		t.Fatalf("Block(9) = %x, want %x", block, want)
	}
}

func TestPlainBlockReturnsExpectedDecryptedBytes(t *testing.T) {
	parsed, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}

	block, err := parsed.PlainBlock(9)
	if err != nil {
		t.Fatal(err)
	}
	want := [8]byte{0x00, 0x00, 0x00, 0x00, 0x0b, 0x06, 0x01, 0x06}
	if block != want {
		t.Fatalf("PlainBlock(9) = %x, want %x", block, want)
	}
}

func TestParsePlainRoundTripsBackToOriginalCiphertext(t *testing.T) {
	parsed, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}
	roundTrip, err := ParsePlain(parsed.PlainBytes())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(roundTrip.Bytes(), parsed.Bytes()) {
		t.Fatal("ParsePlain did not rebuild the original ciphertext preset")
	}
}

func TestBlockRejectsOutOfRangeIndex(t *testing.T) {
	parsed, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := parsed.Block(-1); err == nil {
		t.Fatal("Block(-1) unexpectedly succeeded")
	}
	if _, err := parsed.Block(parsed.BlockCount()); err == nil {
		t.Fatal("Block(BlockCount()) unexpectedly succeeded")
	}
	if _, err := parsed.PlainBlock(parsed.BlockCount()); err == nil {
		t.Fatal("PlainBlock(BlockCount()) unexpectedly succeeded")
	}
}

func TestSHA256IsStableAndLowercase(t *testing.T) {
	parsed, err := Parse(loadFixture(t, "Cute Lahn"))
	if err != nil {
		t.Fatal(err)
	}

	got := parsed.SHA256()
	if len(got) != 64 || got != strings.ToLower(got) {
		t.Fatalf("SHA256() = %q, want 64 lowercase hex characters", got)
	}
	if got != parsed.SHA256() {
		t.Fatal("SHA256() was not stable")
	}
}
