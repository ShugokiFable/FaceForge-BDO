//go:build windows

package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

const (
	desktopSmokeEnv      = "FACEFORGE_BDO_DESKTOP_SMOKE"
	desktopSmokeChildEnv = "FACEFORGE_BDO_DESKTOP_SMOKE_CHILD"
	desktopSmokeRootEnv  = "FACEFORGE_BDO_DESKTOP_SMOKE_ROOT"
)

func TestNativeDesktopWindowStartsAndStops(t *testing.T) {
	if os.Getenv(desktopSmokeEnv) != "1" {
		t.Skip("set FACEFORGE_BDO_DESKTOP_SMOKE=1 to exercise the native WebView2 window")
	}

	runtimeRoot, err := os.MkdirTemp("", "FaceForge-BDO-Desktop-Smoke-")
	if err != nil {
		t.Fatalf("create native smoke runtime: %v", err)
	}

	command := exec.Command(os.Args[0], "-test.run=^TestNativeDesktopWindowSmokeChild$", "-test.v")
	command.Env = append(os.Environ(),
		desktopSmokeChildEnv+"=1",
		desktopSmokeRootEnv+"="+runtimeRoot,
	)
	output, runErr := command.CombinedOutput()
	cleanupErr := removeSmokeRuntime(runtimeRoot, 10*time.Second)

	if runErr != nil {
		t.Fatalf("native desktop child process failed: %v\n%s", runErr, output)
	}
	if cleanupErr != nil {
		t.Logf("native desktop child exited successfully; temporary WebView2 runtime cleanup was incomplete: %v\n%s", cleanupErr, output)
	}
}

func TestNativeDesktopWindowSmokeChild(t *testing.T) {
	if os.Getenv(desktopSmokeChildEnv) != "1" {
		t.Skip("native desktop smoke child runs only under the parent smoke test")
	}

	runtimeRoot := os.Getenv(desktopSmokeRootEnv)
	if runtimeRoot == "" {
		t.Fatal("native desktop smoke root is missing")
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = writer.Write([]byte(`<!doctype html><title>FaceForge BDO smoke test</title><h1>ready</h1>`))
	}))
	defer server.Close()

	stop := make(chan struct{})
	timer := time.AfterFunc(5*time.Second, func() { close(stop) })
	defer timer.Stop()

	if err := runDesktopWindow(server.URL, filepath.Join(runtimeRoot, "WebView2"), false, stop); err != nil {
		t.Fatalf("native desktop smoke test failed: %v", err)
	}
}

func removeSmokeRuntime(path string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		lastErr = os.RemoveAll(path)
		if lastErr == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("remove smoke runtime after retry deadline: %w", lastErr)
		}
		// Windows may keep WebView2 profile files open briefly after the child host
		// exits. The DLL itself is already unlocked because it lived in the child.
		time.Sleep(250 * time.Millisecond)
	}
}
