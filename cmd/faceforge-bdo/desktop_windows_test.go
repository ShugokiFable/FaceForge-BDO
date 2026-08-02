//go:build windows

package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNativeDesktopWindowStartsAndStops(t *testing.T) {
	if os.Getenv("FACEFORGE_BDO_DESKTOP_SMOKE") != "1" {
		t.Skip("set FACEFORGE_BDO_DESKTOP_SMOKE=1 to exercise the native WebView2 window")
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = writer.Write([]byte(`<!doctype html><title>FaceForge BDO smoke test</title><h1>ready</h1>`))
	}))
	defer server.Close()

	stop := make(chan struct{})
	time.AfterFunc(5*time.Second, func() { close(stop) })
	if err := runDesktopWindow(server.URL, filepath.Join(t.TempDir(), "WebView2"), false, stop); err != nil {
		t.Fatalf("native desktop smoke test failed: %v", err)
	}
}
