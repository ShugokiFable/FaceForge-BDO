package storage

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestResolveInsideAcceptsRelativeAndAbsoluteChildren(t *testing.T) {
	root := t.TempDir()
	child := filepath.Join(root, "Cute Lahn")
	if err := os.WriteFile(child, []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}

	relative, err := ResolveInside(root, "Cute Lahn")
	if err != nil {
		t.Fatal(err)
	}
	absolute, err := ResolveInside(root, child)
	if err != nil {
		t.Fatal(err)
	}
	if relative != absolute {
		t.Fatalf("relative %q vs absolute %q", relative, absolute)
	}
	got, err := os.ReadFile(relative)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "ok" {
		t.Fatalf("read %q", got)
	}
}

func TestResolveInsideRejectsTraversalAbsoluteAndSiblingPrefix(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "safe")
	evil := filepath.Join(parent, "safe-evil")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(evil, 0o755); err != nil {
		t.Fatal(err)
	}
	stolen := filepath.Join(evil, "stolen")
	if err := os.WriteFile(stolen, []byte("nope"), 0o600); err != nil {
		t.Fatal(err)
	}

	cases := []string{
		filepath.Join("..", "safe-evil", "stolen"),
		stolen,
		evil,
		filepath.Join(root, "..", "safe-evil", "stolen"),
		"..",
		string(filepath.Separator) + filepath.Join("etc", "passwd"),
	}
	if runtime.GOOS == "windows" {
		cases = append(cases, `C:\Windows\win.ini`, `C:win.ini`)
	}
	for _, name := range cases {
		if _, err := ResolveInside(root, name); err == nil {
			t.Fatalf("ResolveInside(%q) unexpectedly succeeded", name)
		}
	}
}

func TestWithinRootSeparatorAware(t *testing.T) {
	if withinRoot(filepath.Join("tmp", "safe"), filepath.Join("tmp", "safe-evil")) {
		t.Fatal("sibling prefix must not match")
	}
	root := filepath.Join("tmp", "safe")
	child := filepath.Join("tmp", "safe", "file")
	if !withinRoot(root, root) {
		t.Fatal("root must contain itself")
	}
	if !withinRoot(root, child) {
		t.Fatal("root must contain a child")
	}
}

func TestValidFileNameRejectsTraversal(t *testing.T) {
	bad := []string{"", ".", "..", filepath.Join("a", "b"), "../escape", `..\escape`, "a/b", "a\\b"}
	if runtime.GOOS == "windows" {
		bad = append(bad, `C:\Windows\win.ini`, `C:foo`)
	} else {
		bad = append(bad, "/etc/passwd")
	}
	for _, name := range bad {
		if err := validFileName(name); err == nil {
			t.Fatalf("validFileName(%q) unexpectedly succeeded", name)
		}
	}
	if err := validFileName("Cute Lahn"); err != nil {
		t.Fatal(err)
	}
	if err := validFileName("CustomizationData"); err != nil {
		t.Fatal(err)
	}
}

func TestReadFileInsideRejectsEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	payload := []byte("secret")
	if err := os.WriteFile(filepath.Join(outside, "secret"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadFileInside(root, filepath.Join(outside, "secret")); err == nil {
		t.Fatal("ReadFileInside accepted a path outside the root")
	}
	if _, err := ReadFileInside(root, filepath.Join("..", filepath.Base(outside), "secret")); err == nil {
		t.Fatal("ReadFileInside accepted a relative escape")
	}
}

func TestScanPresetsInRootRejectsOutsideDirectory(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if _, err := ScanPresetsInRoot(root, outside); err == nil {
		t.Fatal("ScanPresetsInRoot accepted a directory outside the root")
	}
}

func TestPrefixOfUsesTargetCasing(t *testing.T) {
	root := filepath.Clean("/Allowed/Root")
	target := filepath.Clean("/Allowed/Root/file")
	prefix := prefixOf(root, target)
	sep := string(filepath.Separator)
	if !strings.HasPrefix(target, prefix+sep) && target != prefix {
		t.Fatalf("prefix %q does not cover %q", prefix, target)
	}
}
