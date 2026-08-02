package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestRandomTokenIsURLSafeAndUnpredictableLength(t *testing.T) {
	first, err := randomToken()
	if err != nil {
		t.Fatal(err)
	}
	second, err := randomToken()
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("random tokens must differ")
	}
	if len(first) < 40 {
		t.Fatalf("token too short: %d", len(first))
	}
	if strings.ContainsAny(first, "+/=") {
		t.Fatalf("token is not raw URL safe: %q", first)
	}
}

func TestApplicationURLPlacesTokenInFragment(t *testing.T) {
	got := applicationURL("127.0.0.1:4321", "secret")
	if got != "http://127.0.0.1:4321/#token=secret" {
		t.Fatalf("unexpected URL %q", got)
	}
}

func TestDesktopBuildDoesNotDelegateToSystemBrowser(t *testing.T) {
	data, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, forbidden := range []string{"rundll32", "FileProtocolHandler", "openBrowser"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("desktop app must embed its UI instead of delegating to the system browser; found %q", forbidden)
		}
	}
}

func TestWindowsDesktopHostIsSelfContainedWebView2Window(t *testing.T) {
	data, err := os.ReadFile("desktop_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, required := range []string{
		"//go:embed WebView2Loader.dll",
		"CreateCoreWebView2EnvironmentWithOptions",
		"CreateCoreWebView2Controller",
		"GetCoreWebView2",
		"Navigate",
		"GetMessageW",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("native Windows host is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"github.com/jchv/go-webview2",
		"golang.org/x/sys/windows",
		"rundll32",
		"FileProtocolHandler",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("native Windows host must not depend on a browser launcher or online Go module; found %q", forbidden)
		}
	}
}

func TestWindowsDesktopRetainsCOMInterfacesAcrossCallbacks(t *testing.T) {
	data, err := os.ReadFile("desktop_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, required := range []string{
		"environment.Vtbl.AddRef",
		"controller.Vtbl.AddRef",
		"webview.Vtbl.AddRef",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("native desktop must retain COM interface lifetime with %q", required)
		}
	}
}

func TestPowerShellEntryPointsDoNotUsePSScriptRootInParamDefaults(t *testing.T) {
	for _, relative := range []string{
		"../../build.ps1",
		"../../package.ps1",
		"../../publish-github.ps1",
		"../../scripts/verify-release.ps1",
	} {
		data, err := os.ReadFile(relative)
		if err != nil {
			t.Fatalf("read %s: %v", relative, err)
		}
		source := string(data)
		paramBlock := regexp.MustCompile(`(?s)param\(.*?\)\r?\n`).FindString(source)
		if paramBlock == "" {
			t.Fatalf("could not find param block in %s", relative)
		}
		if strings.Contains(paramBlock, "$PSScriptRoot") {
			t.Fatalf("%s reads $PSScriptRoot while param defaults are evaluated", relative)
		}
	}
}

func TestEmbeddedWebView2LoaderIsPresent(t *testing.T) {
	data, err := os.ReadFile("WebView2Loader.dll")
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 100*1024 {
		t.Fatalf("WebView2 loader is unexpectedly small: %d bytes", len(data))
	}
	if len(data) < 2 || data[0] != 'M' || data[1] != 'Z' {
		t.Fatal("WebView2 loader is not a Windows PE file")
	}
}
