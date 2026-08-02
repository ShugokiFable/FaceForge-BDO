package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
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

	schemaassets "github.com/ShugokiFable/FaceForge-BDO/assets/schema"
	"github.com/ShugokiFable/FaceForge-BDO/internal/app"
	"github.com/ShugokiFable/FaceForge-BDO/internal/preset"
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

func loadSchema() (preset.Schema, error) {
	data, err := schemaassets.FS.ReadFile("version20.json")
	if err != nil {
		return preset.Schema{}, fmt.Errorf("read embedded preset schema: %w", err)
	}
	var schema preset.Schema
	if err := json.Unmarshal(data, &schema); err != nil {
		return preset.Schema{}, fmt.Errorf("decode embedded preset schema: %w", err)
	}
	if err := schema.Validate(); err != nil {
		return preset.Schema{}, err
	}
	return schema, nil
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

	schema, err := loadSchema()
	if err != nil {
		reportFatal(logger, headless, err)
		return
	}
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
	handler := app.NewHandler(app.Config{
		Token:            token,
		Schema:           schema,
		CustomizationDir: filepath.Clean(customizationDir),
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
