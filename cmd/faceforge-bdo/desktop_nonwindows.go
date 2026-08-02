//go:build !windows

package main

func acquireSingleInstance() (func(), error) {
	return func() {}, nil
}

func runDesktopWindow(url, dataPath string, debug bool, stop <-chan struct{}) error {
	return errDesktopUnsupported
}

func webViewDataPath() string {
	return ""
}

func notifyFatalError(title, message string) {}
func notifyAlreadyRunning()                  {}
