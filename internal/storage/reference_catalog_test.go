package storage

import (
	"path/filepath"
	"testing"
)

func TestReferenceCatalogPersistsProfilesAcrossReloads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "reference-catalog.json")
	catalog := EmptyReferenceCatalog()
	catalog.Profiles["ABCDEF"] = ReferenceProfile{
		SHA256:           "ABCDEF",
		Name:             "Striker Reference",
		ClassFingerprint: "class-one",
		ImageName:        "striker.png",
		Metrics:          map[string]float64{"jawWidth": 0.62},
		Quality:          map[string]float64{"symmetry": 0.91},
	}

	if err := SaveReferenceCatalog(path, catalog); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadReferenceCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	profile, ok := loaded.Profiles["abcdef"]
	if !ok {
		t.Fatalf("normalized profile missing: %+v", loaded.Profiles)
	}
	if profile.SHA256 != "abcdef" || profile.Name != "Striker Reference" || profile.Metrics["jawWidth"] != 0.62 {
		t.Fatalf("unexpected persisted profile: %+v", profile)
	}
}

func TestLoadReferenceCatalogReturnsEmptyCatalogWhenFileDoesNotExist(t *testing.T) {
	catalog, err := LoadReferenceCatalog(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Version != 1 || len(catalog.Profiles) != 0 {
		t.Fatalf("unexpected empty catalog: %+v", catalog)
	}
}
