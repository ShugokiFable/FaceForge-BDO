package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/ShugokiFable/FaceForge-BDO/internal/app"
	"github.com/ShugokiFable/FaceForge-BDO/internal/storage"
	webassets "github.com/ShugokiFable/FaceForge-BDO/web"
)

var buildVersion = app.Version

const appWindowTitle = "FaceForge BDO"

var (
	errAlreadyRunning     = errors.New("FaceForge BDO is already running")
	errDesktopUnsupported = errors.New("the desktop window is supported only on Windows")
)

func randomToken() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("create local service token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func applicationURL(address, token string) string {
	return fmt.Sprintf("http://%s/#token=%s", address, token)
}

// resolveSliderMapPath returns the writable slider map path. A calibration is
// expensive to produce, so if the user has none yet but shipped one next to the
// EXE, that is seeded in: it lets one person's 12 saves serve everybody.
func resolveSliderMapPath(logger *log.Logger) string {
	dataDir := localDataDir()
	if dataDir == "" {
		return ""
	}
	target := filepath.Join(dataDir, "slidermap.json")
	if _, err := os.Stat(target); err == nil {
		return target
	}
	executable, err := os.Executable()
	if err != nil {
		return target
	}
	seed := filepath.Join(filepath.Dir(executable), "slidermap.json")
	data, err := os.ReadFile(seed)
	if err != nil {
		return target
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return target
	}
	if err := os.WriteFile(target, data, 0o600); err != nil {
		logger.Printf("could not seed slider map from %s: %v", seed, err)
		return target
	}
	logger.Printf("seeded slider map from %s", seed)
	return target
}

func localDataDir() string {
	if base := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); base != "" {
		return filepath.Join(base, "FaceForge BDO")
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".faceforge-bdo")
}

func logWriter() (io.Writer, func()) {
	base := localDataDir()
	if base == "" {
		return os.Stderr, func() {}
	}
	path := filepath.Join(base, "logs", "FaceForge BDO.log")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return os.Stderr, func() {}
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return os.Stderr, func() {}
	}
	return io.MultiWriter(os.Stderr, file), func() { _ = file.Close() }
}

func reportFatal(logger *log.Logger, headless bool, err error) {
	logger.Printf("fatal: %v", err)
	if !headless {
		notifyFatalError(app.ProductName, err.Error())
	}
}

func main() {
	var headless bool
	var debug bool
	var port int
	var customizationDir string
	flag.BoolVar(&headless, "headless", false, "run the local service without the desktop window")
	flag.BoolVar(&debug, "debug", false, "enable WebView2 developer tools and context menus")
	flag.IntVar(&port, "port", 0, "loopback TCP port, with 0 selecting a free port")
	flag.StringVar(&customizationDir, "customization-dir", "", "override the Black Desert customization directory")
	flag.Parse()

	if !headless {
		releaseInstance, instanceErr := acquireSingleInstance()
		if instanceErr != nil {
			if errors.Is(instanceErr, errAlreadyRunning) {
				notifyAlreadyRunning()
				return
			}
			notifyFatalError(appWindowTitle, instanceErr.Error())
			return
		}
		defer releaseInstance()
	}

	output, closeLog := logWriter()
	defer closeLog()
	logger := log.New(output, "FaceForge BDO: ", log.Ldate|log.Ltime|log.Lmicroseconds|log.LUTC)

	var err error
	if strings.TrimSpace(customizationDir) == "" {
		customizationDir, err = storage.DiscoverCustomizationDir()
		if err != nil {
			reportFatal(logger, headless, err)
			return
		}
	}
	token, err := randomToken()
	if err != nil {
		reportFatal(logger, headless, err)
		return
	}

	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		reportFatal(logger, headless, fmt.Errorf("listen on loopback: %w", err))
		return
	}
	defer listener.Close()

	shutdownRequested := make(chan struct{}, 1)
	sliderMapPath := resolveSliderMapPath(logger)
	handler := app.NewHandler(app.Config{
		Token:            token,
		CustomizationDir: filepath.Clean(customizationDir),
		SliderMapPath:    sliderMapPath,
		StaticFS:         webassets.FS,
		Shutdown: func() {
			select {
			case shutdownRequested <- struct{}{}:
			default:
			}
		},
	})
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	address := listener.Addr().String()
	url := applicationURL(address, token)
	logger.Printf("starting %s %s at http://%s", app.ProductName, buildVersion, address)
	logger.Printf("customization directory: %s", customizationDir)

	serveErrors := make(chan error, 1)
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			serveErrors <- serveErr
		}
		close(serveErrors)
	}()

	signalContext, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	if headless {
		fmt.Println(url)
		select {
		case <-signalContext.Done():
			logger.Print("shutdown requested by operating system")
		case <-shutdownRequested:
			logger.Print("shutdown requested by app UI")
		case serveErr := <-serveErrors:
			if serveErr != nil {
				logger.Printf("service failed: %v", serveErr)
			}
		}
	} else {
		windowStop := make(chan struct{})
		windowReason := make(chan string, 1)
		go func() {
			select {
			case <-signalContext.Done():
				windowReason <- "shutdown requested by operating system"
			case <-shutdownRequested:
				windowReason <- "shutdown requested by app UI"
			case serveErr := <-serveErrors:
				if serveErr != nil {
					windowReason <- fmt.Sprintf("service failed: %v", serveErr)
				} else {
					windowReason <- "local service stopped"
				}
			}
			close(windowStop)
		}()

		if err := runDesktopWindow(url, webViewDataPath(), debug, windowStop); err != nil {
			reportFatal(logger, false, err)
		} else {
			select {
			case reason := <-windowReason:
				logger.Print(reason)
			default:
				logger.Print("desktop window closed")
			}
		}
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		logger.Printf("shutdown error: %v", err)
	}
	logger.Print("stopped")
}
