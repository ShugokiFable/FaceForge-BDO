//go:build windows

package main

import (
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

const (
	singleInstanceMutexName = `Local\FaceForgeBDO_9B6C4FE9_0E5D_4B93_A513_86D0A7754426`
	windowClassName         = `FaceForgeBDONativeWindow`

	coinitApartmentThreaded = 0x2
	rpcEChangedMode         = 0x80010106
	errorAlreadyExists      = 183

	wsOverlappedWindow = 0x00CF0000
	cwUseDefault       = 0x80000000
	swShow             = 5
	idiApplication     = 32512
	idcArrow           = 32512
	colorWindow        = 5

	wmDestroy       = 0x0002
	wmSize          = 0x0005
	wmSetFocus      = 0x0007
	wmClose         = 0x0010
	wmGetMinMaxInfo = 0x0024
	wmMove          = 0x0003
	wmMoving        = 0x0216

	sOK = 0
)

// WebView2Loader.dll is Microsoft's x64 loader. It is embedded so the release
// remains one executable and is extracted into the app's private runtime folder.
//
//go:embed WebView2Loader.dll
var embeddedWebView2Loader []byte

var (
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	user32   = syscall.NewLazyDLL("user32.dll")
	ole32    = syscall.NewLazyDLL("ole32.dll")

	procCreateMutexW     = kernel32.NewProc("CreateMutexW")
	procCloseHandle      = kernel32.NewProc("CloseHandle")
	procGetLastError     = kernel32.NewProc("GetLastError")
	procGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procDestroyWindow    = user32.NewProc("DestroyWindow")
	procShowWindow       = user32.NewProc("ShowWindow")
	procUpdateWindow     = user32.NewProc("UpdateWindow")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
	procPostMessageW     = user32.NewProc("PostMessageW")
	procGetClientRect    = user32.NewProc("GetClientRect")
	procLoadIconW        = user32.NewProc("LoadIconW")
	procLoadCursorW      = user32.NewProc("LoadCursorW")
	procMessageBoxW      = user32.NewProc("MessageBoxW")
	procSetForegroundWnd = user32.NewProc("SetForegroundWindow")
	procCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	procCoUninitialize   = ole32.NewProc("CoUninitialize")
)

type point struct {
	X int32
	Y int32
}

type rect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type message struct {
	HWND     uintptr
	Message  uint32
	WParam   uintptr
	LParam   uintptr
	Time     uint32
	Pt       point
	LPrivate uint32
}

type wndClassExW struct {
	CbSize     uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSmall  uintptr
}

type minMaxInfo struct {
	Reserved     point
	MaxSize      point
	MaxPosition  point
	MinTrackSize point
	MaxTrackSize point
}

type iUnknownVtbl struct {
	QueryInterface uintptr
	AddRef         uintptr
	Release        uintptr
}

type iCoreWebView2EnvironmentVtbl struct {
	iUnknownVtbl
	CreateCoreWebView2Controller     uintptr
	CreateWebResourceResponse        uintptr
	GetBrowserVersionString          uintptr
	AddNewBrowserVersionAvailable    uintptr
	RemoveNewBrowserVersionAvailable uintptr
}

type iCoreWebView2Environment struct {
	Vtbl *iCoreWebView2EnvironmentVtbl
}

type iCoreWebView2ControllerVtbl struct {
	iUnknownVtbl
	GetIsVisible                      uintptr
	PutIsVisible                      uintptr
	GetBounds                         uintptr
	PutBounds                         uintptr
	GetZoomFactor                     uintptr
	PutZoomFactor                     uintptr
	AddZoomFactorChanged              uintptr
	RemoveZoomFactorChanged           uintptr
	SetBoundsAndZoomFactor            uintptr
	MoveFocus                         uintptr
	AddMoveFocusRequested             uintptr
	RemoveMoveFocusRequested          uintptr
	AddGotFocus                       uintptr
	RemoveGotFocus                    uintptr
	AddLostFocus                      uintptr
	RemoveLostFocus                   uintptr
	AddAcceleratorKeyPressed          uintptr
	RemoveAcceleratorKeyPressed       uintptr
	GetParentWindow                   uintptr
	PutParentWindow                   uintptr
	NotifyParentWindowPositionChanged uintptr
	Close                             uintptr
	GetCoreWebView2                   uintptr
}

type iCoreWebView2Controller struct {
	Vtbl *iCoreWebView2ControllerVtbl
}

type iCoreWebView2Vtbl struct {
	iUnknownVtbl
	GetSettings                            uintptr
	GetSource                              uintptr
	Navigate                               uintptr
	NavigateToString                       uintptr
	AddNavigationStarting                  uintptr
	RemoveNavigationStarting               uintptr
	AddContentLoading                      uintptr
	RemoveContentLoading                   uintptr
	AddSourceChanged                       uintptr
	RemoveSourceChanged                    uintptr
	AddHistoryChanged                      uintptr
	RemoveHistoryChanged                   uintptr
	AddNavigationCompleted                 uintptr
	RemoveNavigationCompleted              uintptr
	AddFrameNavigationStarting             uintptr
	RemoveFrameNavigationStarting          uintptr
	AddFrameNavigationCompleted            uintptr
	RemoveFrameNavigationCompleted         uintptr
	AddScriptDialogOpening                 uintptr
	RemoveScriptDialogOpening              uintptr
	AddPermissionRequested                 uintptr
	RemovePermissionRequested              uintptr
	AddProcessFailed                       uintptr
	RemoveProcessFailed                    uintptr
	AddScriptToExecuteOnDocumentCreated    uintptr
	RemoveScriptToExecuteOnDocumentCreated uintptr
	ExecuteScript                          uintptr
	CapturePreview                         uintptr
	Reload                                 uintptr
	PostWebMessageAsJSON                   uintptr
	PostWebMessageAsString                 uintptr
	AddWebMessageReceived                  uintptr
	RemoveWebMessageReceived               uintptr
	CallDevToolsProtocolMethod             uintptr
	GetBrowserProcessID                    uintptr
	GetCanGoBack                           uintptr
	GetCanGoForward                        uintptr
	GoBack                                 uintptr
	GoForward                              uintptr
	GetDevToolsProtocolEventReceiver       uintptr
	Stop                                   uintptr
	AddNewWindowRequested                  uintptr
	RemoveNewWindowRequested               uintptr
	AddDocumentTitleChanged                uintptr
	RemoveDocumentTitleChanged             uintptr
	GetDocumentTitle                       uintptr
	AddHostObjectToScript                  uintptr
	RemoveHostObjectFromScript             uintptr
	OpenDevToolsWindow                     uintptr
	AddContainsFullScreenElementChanged    uintptr
	RemoveContainsFullScreenElementChanged uintptr
	GetContainsFullScreenElement           uintptr
	AddWebResourceRequested                uintptr
	RemoveWebResourceRequested             uintptr
	AddWebResourceRequestedFilter          uintptr
	RemoveWebResourceRequestedFilter       uintptr
	AddWindowCloseRequested                uintptr
	RemoveWindowCloseRequested             uintptr
}

type iCoreWebView2 struct {
	Vtbl *iCoreWebView2Vtbl
}

type completedHandlerVtbl struct {
	iUnknownVtbl
	Invoke uintptr
}

type environmentCompletedHandler struct {
	Vtbl *completedHandlerVtbl
	Refs uint32
	App  *nativeDesktop
}

type controllerCompletedHandler struct {
	Vtbl *completedHandlerVtbl
	Refs uint32
	App  *nativeDesktop
}

type nativeDesktop struct {
	hwnd  uintptr
	url   string
	debug bool

	environment *iCoreWebView2Environment
	controller  *iCoreWebView2Controller
	webview     *iCoreWebView2

	environmentHandler *environmentCompletedHandler
	controllerHandler  *controllerCompletedHandler

	loaderDLL *syscall.LazyDLL
	createEnv *syscall.LazyProc

	errMu     sync.Mutex
	err       error
	closing   atomic.Bool
	ready     chan struct{}
	readyOnce sync.Once
}

var activeDesktop *nativeDesktop

var environmentHandlerVTable = completedHandlerVtbl{
	iUnknownVtbl: iUnknownVtbl{
		QueryInterface: syscall.NewCallback(environmentQueryInterface),
		AddRef:         syscall.NewCallback(environmentAddRef),
		Release:        syscall.NewCallback(environmentRelease),
	},
	Invoke: syscall.NewCallback(environmentInvoke),
}

var controllerHandlerVTable = completedHandlerVtbl{
	iUnknownVtbl: iUnknownVtbl{
		QueryInterface: syscall.NewCallback(controllerQueryInterface),
		AddRef:         syscall.NewCallback(controllerAddRef),
		Release:        syscall.NewCallback(controllerRelease),
	},
	Invoke: syscall.NewCallback(controllerInvoke),
}

func acquireSingleInstance() (func(), error) {
	name, err := syscall.UTF16PtrFromString(singleInstanceMutexName)
	if err != nil {
		return nil, fmt.Errorf("prepare single-instance lock: %w", err)
	}
	handle, _, callErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return nil, fmt.Errorf("create single-instance lock: %w", callErr)
	}
	lastError, _, _ := procGetLastError.Call()
	if lastError == errorAlreadyExists {
		procCloseHandle.Call(handle)
		return nil, errAlreadyRunning
	}
	return func() { procCloseHandle.Call(handle) }, nil
}

func runDesktopWindow(url, dataPath string, debug bool, stop <-chan struct{}) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	_ = debug

	loaderPath, err := installEmbeddedWebView2Loader(dataPath)
	if err != nil {
		return err
	}

	coResult, _, _ := procCoInitializeEx.Call(0, coinitApartmentThreaded)
	if hresultFailed(coResult) && uint32(coResult) != rpcEChangedMode {
		return hresultError("initialize COM", coResult)
	}
	if uint32(coResult) != rpcEChangedMode {
		defer procCoUninitialize.Call()
	}

	desktop := &nativeDesktop{url: url, debug: debug, ready: make(chan struct{})}
	desktop.loaderDLL = syscall.NewLazyDLL(loaderPath)
	desktop.createEnv = desktop.loaderDLL.NewProc("CreateCoreWebView2EnvironmentWithOptions")
	desktop.environmentHandler = &environmentCompletedHandler{Vtbl: &environmentHandlerVTable, Refs: 1, App: desktop}
	desktop.controllerHandler = &controllerCompletedHandler{Vtbl: &controllerHandlerVTable, Refs: 1, App: desktop}
	activeDesktop = desktop
	defer func() {
		desktop.releaseWebView()
		activeDesktop = nil
	}()

	if err := desktop.createWindow(); err != nil {
		return err
	}

	userData, err := syscall.UTF16PtrFromString(dataPath)
	if err != nil {
		return fmt.Errorf("prepare WebView2 data path: %w", err)
	}
	hr, _, _ := desktop.createEnv.Call(
		0,
		uintptr(unsafe.Pointer(userData)),
		0,
		uintptr(unsafe.Pointer(desktop.environmentHandler)),
	)
	if hresultFailed(hr) {
		return hresultError("CreateCoreWebView2EnvironmentWithOptions", hr)
	}

	windowClosed := make(chan struct{})
	defer close(windowClosed)
	go func(hwnd uintptr) {
		select {
		case <-stop:
			procPostMessageW.Call(hwnd, wmClose, 0, 0)
		case <-windowClosed:
		}
	}(desktop.hwnd)
	go func() {
		timer := time.NewTimer(30 * time.Second)
		defer timer.Stop()
		select {
		case <-desktop.ready:
		case <-timer.C:
			desktop.fail(errors.New("WebView2 did not finish starting within 30 seconds"))
		case <-windowClosed:
		}
	}()

	procShowWindow.Call(desktop.hwnd, swShow)
	procUpdateWindow.Call(desktop.hwnd)

	var msg message
	for {
		result, _, callErr := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) == -1 {
			return fmt.Errorf("GetMessageW failed: %w", callErr)
		}
		if result == 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}

	return desktop.failure()
}

func installEmbeddedWebView2Loader(dataPath string) (string, error) {
	base := filepath.Dir(dataPath)
	if base == "." || base == "" {
		base = localDataDir()
	}
	if base == "" {
		base = os.TempDir()
	}
	runtimeDir := filepath.Join(base, "runtime")
	if err := os.MkdirAll(runtimeDir, 0o755); err != nil {
		return "", fmt.Errorf("create runtime directory: %w", err)
	}
	loaderPath := filepath.Join(runtimeDir, "WebView2Loader.dll")
	current, readErr := os.ReadFile(loaderPath)
	if readErr == nil && bytes.Equal(current, embeddedWebView2Loader) {
		return loaderPath, nil
	}
	temporary := loaderPath + ".new"
	if err := os.WriteFile(temporary, embeddedWebView2Loader, 0o600); err != nil {
		return "", fmt.Errorf("write embedded WebView2 loader: %w", err)
	}
	if readErr == nil {
		if err := os.Remove(loaderPath); err != nil {
			_ = os.Remove(temporary)
			return "", fmt.Errorf("replace embedded WebView2 loader: %w", err)
		}
	}
	if err := os.Rename(temporary, loaderPath); err != nil {
		_ = os.Remove(temporary)
		return "", fmt.Errorf("activate embedded WebView2 loader: %w", err)
	}
	return loaderPath, nil
}

func (desktop *nativeDesktop) createWindow() error {
	instance, _, callErr := procGetModuleHandleW.Call(0)
	if instance == 0 {
		return fmt.Errorf("GetModuleHandleW failed: %w", callErr)
	}
	className, _ := syscall.UTF16PtrFromString(windowClassName)
	icon, _, _ := procLoadIconW.Call(0, idiApplication)
	cursor, _, _ := procLoadCursorW.Call(0, idcArrow)
	windowClass := wndClassExW{
		CbSize:     uint32(unsafe.Sizeof(wndClassExW{})),
		WndProc:    syscall.NewCallback(windowProcedure),
		Instance:   instance,
		Icon:       icon,
		Cursor:     cursor,
		Background: colorWindow + 1,
		ClassName:  className,
		IconSmall:  icon,
	}
	registered, _, registerErr := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&windowClass)))
	if registered == 0 {
		last, _, _ := procGetLastError.Call()
		if last != 1410 { // ERROR_CLASS_ALREADY_EXISTS
			return fmt.Errorf("RegisterClassExW failed: %w", registerErr)
		}
	}
	title, _ := syscall.UTF16PtrFromString(appWindowTitle)
	hwnd, _, createErr := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
		wsOverlappedWindow,
		cwUseDefault,
		cwUseDefault,
		1440,
		900,
		0,
		0,
		instance,
		0,
	)
	if hwnd == 0 {
		return fmt.Errorf("CreateWindowExW failed: %w", createErr)
	}
	desktop.hwnd = hwnd
	return nil
}

func windowProcedure(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	desktop := activeDesktop
	switch message {
	case wmSize:
		if desktop != nil {
			desktop.resize()
		}
		return 0
	case wmMove, wmMoving:
		if desktop != nil && desktop.controller != nil {
			syscall.SyscallN(desktop.controller.Vtbl.NotifyParentWindowPositionChanged, uintptr(unsafe.Pointer(desktop.controller)))
		}
		return 0
	case wmSetFocus:
		if desktop != nil && desktop.controller != nil {
			syscall.SyscallN(desktop.controller.Vtbl.MoveFocus, uintptr(unsafe.Pointer(desktop.controller)), 0)
		}
		return 0
	case wmGetMinMaxInfo:
		info := (*minMaxInfo)(unsafe.Pointer(lParam))
		info.MinTrackSize = point{X: 1100, Y: 700}
		return 0
	case wmClose:
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		if desktop != nil {
			desktop.releaseWebView()
		}
		procPostQuitMessage.Call(0)
		return 0
	default:
		result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
}

func environmentQueryInterface(this, _, object uintptr) uintptr {
	if object == 0 {
		return 0x80004003 // E_POINTER
	}
	*(*uintptr)(unsafe.Pointer(object)) = this
	environmentAddRef(this)
	return sOK
}

func environmentAddRef(this uintptr) uintptr {
	handler := (*environmentCompletedHandler)(unsafe.Pointer(this))
	return uintptr(atomic.AddUint32(&handler.Refs, 1))
}

func environmentRelease(this uintptr) uintptr {
	handler := (*environmentCompletedHandler)(unsafe.Pointer(this))
	return uintptr(atomic.AddUint32(&handler.Refs, ^uint32(0)))
}

func environmentInvoke(this, result, environment uintptr) uintptr {
	handler := (*environmentCompletedHandler)(unsafe.Pointer(this))
	if hresultFailed(result) || environment == 0 {
		handler.App.fail(hresultError("create WebView2 environment", result))
		return sOK
	}
	handler.App.environment = (*iCoreWebView2Environment)(unsafe.Pointer(environment))
	// The completion callback lends us this COM pointer. Retain our own
	// reference because the callback may release its reference after returning.
	syscall.SyscallN(handler.App.environment.Vtbl.AddRef, environment)
	hr, _, _ := syscall.SyscallN(
		handler.App.environment.Vtbl.CreateCoreWebView2Controller,
		environment,
		handler.App.hwnd,
		uintptr(unsafe.Pointer(handler.App.controllerHandler)),
	)
	if hresultFailed(hr) {
		handler.App.fail(hresultError("CreateCoreWebView2Controller", hr))
	}
	return sOK
}

func controllerQueryInterface(this, _, object uintptr) uintptr {
	if object == 0 {
		return 0x80004003
	}
	*(*uintptr)(unsafe.Pointer(object)) = this
	controllerAddRef(this)
	return sOK
}

func controllerAddRef(this uintptr) uintptr {
	handler := (*controllerCompletedHandler)(unsafe.Pointer(this))
	return uintptr(atomic.AddUint32(&handler.Refs, 1))
}

func controllerRelease(this uintptr) uintptr {
	handler := (*controllerCompletedHandler)(unsafe.Pointer(this))
	return uintptr(atomic.AddUint32(&handler.Refs, ^uint32(0)))
}

func controllerInvoke(this, result, controller uintptr) uintptr {
	handler := (*controllerCompletedHandler)(unsafe.Pointer(this))
	if hresultFailed(result) || controller == 0 {
		handler.App.fail(hresultError("create WebView2 controller", result))
		return sOK
	}
	handler.App.controller = (*iCoreWebView2Controller)(unsafe.Pointer(controller))
	// Keep an explicit reference for the lifetime of the native window.
	syscall.SyscallN(handler.App.controller.Vtbl.AddRef, controller)
	var webview *iCoreWebView2
	hr, _, _ := syscall.SyscallN(
		handler.App.controller.Vtbl.GetCoreWebView2,
		controller,
		uintptr(unsafe.Pointer(&webview)),
	)
	if hresultFailed(hr) || webview == nil {
		handler.App.fail(hresultError("GetCoreWebView2", hr))
		return sOK
	}
	handler.App.webview = webview
	// GetCoreWebView2 returns an interface pointer that the host stores until
	// shutdown, so retain it before leaving the completion callback.
	syscall.SyscallN(handler.App.webview.Vtbl.AddRef, uintptr(unsafe.Pointer(handler.App.webview)))
	handler.App.resize()
	hr, _, _ = syscall.SyscallN(handler.App.controller.Vtbl.PutIsVisible, controller, 1)
	if hresultFailed(hr) {
		handler.App.fail(hresultError("show WebView2 controller", hr))
		return sOK
	}
	url, err := syscall.UTF16PtrFromString(handler.App.url)
	if err != nil {
		handler.App.fail(fmt.Errorf("prepare application URL: %w", err))
		return sOK
	}
	hr, _, _ = syscall.SyscallN(
		handler.App.webview.Vtbl.Navigate,
		uintptr(unsafe.Pointer(handler.App.webview)),
		uintptr(unsafe.Pointer(url)),
	)
	if hresultFailed(hr) {
		handler.App.fail(hresultError("Navigate", hr))
		return sOK
	}
	if handler.App.debug {
		syscall.SyscallN(handler.App.webview.Vtbl.OpenDevToolsWindow, uintptr(unsafe.Pointer(handler.App.webview)))
	}
	handler.App.markReady()
	return sOK
}

func (desktop *nativeDesktop) resize() {
	if desktop == nil || desktop.hwnd == 0 || desktop.controller == nil {
		return
	}
	var bounds rect
	result, _, _ := procGetClientRect.Call(desktop.hwnd, uintptr(unsafe.Pointer(&bounds)))
	if result == 0 {
		return
	}
	syscall.SyscallN(
		desktop.controller.Vtbl.PutBounds,
		uintptr(unsafe.Pointer(desktop.controller)),
		uintptr(unsafe.Pointer(&bounds)),
	)
}

func (desktop *nativeDesktop) markReady() {
	if desktop == nil || desktop.ready == nil {
		return
	}
	desktop.readyOnce.Do(func() { close(desktop.ready) })
}

func (desktop *nativeDesktop) fail(err error) {
	if err == nil {
		return
	}
	desktop.errMu.Lock()
	if desktop.err == nil {
		desktop.err = err
	}
	desktop.errMu.Unlock()
	if desktop.hwnd != 0 {
		procPostMessageW.Call(desktop.hwnd, wmClose, 0, 0)
	}
}

func (desktop *nativeDesktop) failure() error {
	desktop.errMu.Lock()
	defer desktop.errMu.Unlock()
	return desktop.err
}

func (desktop *nativeDesktop) releaseWebView() {
	if desktop == nil || !desktop.closing.CompareAndSwap(false, true) {
		return
	}
	if desktop.webview != nil {
		releaseCOM(uintptr(unsafe.Pointer(desktop.webview)), desktop.webview.Vtbl.Release)
		desktop.webview = nil
	}
	if desktop.controller != nil {
		syscall.SyscallN(desktop.controller.Vtbl.Close, uintptr(unsafe.Pointer(desktop.controller)))
		releaseCOM(uintptr(unsafe.Pointer(desktop.controller)), desktop.controller.Vtbl.Release)
		desktop.controller = nil
	}
	if desktop.environment != nil {
		releaseCOM(uintptr(unsafe.Pointer(desktop.environment)), desktop.environment.Vtbl.Release)
		desktop.environment = nil
	}
}

func releaseCOM(object, releaseProc uintptr) {
	if object != 0 && releaseProc != 0 {
		syscall.SyscallN(releaseProc, object)
	}
}

func hresultFailed(result uintptr) bool {
	return int32(result) < 0
}

func hresultError(operation string, result uintptr) error {
	return fmt.Errorf("%s failed with HRESULT 0x%08X", operation, uint32(result))
}

func webViewDataPath() string {
	base := localDataDir()
	if base == "" {
		return ""
	}
	return filepath.Join(base, "WebView2")
}

func notifyFatalError(title, message string) {
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	messagePtr, _ := syscall.UTF16PtrFromString(message)
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(messagePtr)), uintptr(unsafe.Pointer(titlePtr)), 0x10)
}

func notifyAlreadyRunning() {
	if activeDesktop != nil && activeDesktop.hwnd != 0 {
		procSetForegroundWnd.Call(activeDesktop.hwnd)
	}
	notifyFatalError(appWindowTitle, "FaceForge BDO is already running.")
}
