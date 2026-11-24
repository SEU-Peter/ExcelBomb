//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
)

var shellDLL = syscall.NewLazyDLL("shell32.dll")
var registryDLL = syscall.NewLazyDLL("advapi32.dll")
var oleDLL = syscall.NewLazyDLL("ole32.dll")

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const uninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcelBomb`

func native64Bit() bool {
	if runtime.GOARCH == "amd64" {
		return true
	}
	var wow uint32
	handle, err := syscall.GetCurrentProcess()
	if err != nil {
		return false
	}
	result, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("IsWow64Process").Call(uintptr(handle), uintptr(unsafe.Pointer(&wow)))
	return result != 0 && wow != 0
}

func knownFolder(id uintptr) (string, error) {
	var buffer [260]uint16
	result, _, _ := shellDLL.NewProc("SHGetFolderPathW").Call(0, id|0x8000, 0, 0, uintptr(unsafe.Pointer(&buffer[0])))
	if uint32(result)&0x80000000 != 0 {
		return "", fmt.Errorf("无法获取 Windows 用户目录：0x%x", result)
	}
	return syscall.UTF16ToString(buffer[:]), nil
}

func userInstallPaths() (installPaths, error) {
	local, err := knownFolder(0x1c)
	if err != nil {
		return installPaths{}, err
	}
	desktop, err := knownFolder(0x10)
	if err != nil {
		return installPaths{}, err
	}
	return installPaths{filepath.Join(local, "ExcelBomb"), desktop}, nil
}

func registryAccess() uintptr {
	if native64Bit() {
		return 0x100
	}
	return 0
}

func createUserKey(name string) (syscall.Handle, error) {
	text, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	var key syscall.Handle
	result, _, _ := registryDLL.NewProc("RegCreateKeyExW").Call(syscall.HKEY_CURRENT_USER, uintptr(unsafe.Pointer(text)), 0, 0, 0, 0x3|registryAccess(), 0, uintptr(unsafe.Pointer(&key)), 0)
	if result != 0 {
		return 0, syscall.Errno(result)
	}
	return key, nil
}

func closeUserKey(key syscall.Handle) { registryDLL.NewProc("RegCloseKey").Call(uintptr(key)) }

func setRegistryText(key syscall.Handle, name, value string) error {
	n, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	data, err := syscall.UTF16FromString(value)
	if err != nil {
		return err
	}
	result, _, _ := registryDLL.NewProc("RegSetValueExW").Call(uintptr(key), uintptr(unsafe.Pointer(n)), 0, 1, uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)*2))
	if result != 0 {
		return syscall.Errno(result)
	}
	return nil
}

func setAutostart(executable string, enabled bool) error {
	key, err := createUserKey(runKey)
	if err != nil {
		return err
	}
	defer closeUserKey(key)
	if enabled {
		command, err := startupCommand(executable)
		if err != nil {
			return err
		}
		return setRegistryText(key, "ExcelBomb", command)
	}
	name, _ := syscall.UTF16PtrFromString("ExcelBomb")
	result, _, _ := registryDLL.NewProc("RegDeleteValueW").Call(uintptr(key), uintptr(unsafe.Pointer(name)))
	if result != 0 && result != 2 {
		return syscall.Errno(result)
	}
	return nil
}

func registerUninstaller(directory string) error {
	key, err := createUserKey(uninstallKey)
	if err != nil {
		return err
	}
	defer closeUserKey(key)
	// The OS command processor is already part of Windows 7. No WSH, VBScript,
	// PowerShell or extra runtime is used for installation or shortcuts.
	processor := filepath.Join(os.Getenv("SystemRoot"), "System32", "cmd.exe")
	command := `"` + processor + `" /d /v:off /c ""` + filepath.Join(directory, "Uninstall-ExcelBomb.cmd") + `""`
	for name, value := range map[string]string{"DisplayName": "ExcelBomb", "DisplayVersion": version, "Publisher": "万晔", "InstallLocation": directory, "UninstallString": command, "DisplayIcon": filepath.Join(directory, "ExcelBomb.exe")} {
		if err = setRegistryText(key, name, value); err != nil {
			return err
		}
	}
	for _, name := range []string{"NoModify", "NoRepair"} {
		n, _ := syscall.UTF16PtrFromString(name)
		value := uint32(1)
		result, _, _ := registryDLL.NewProc("RegSetValueExW").Call(uintptr(key), uintptr(unsafe.Pointer(n)), 0, 4, uintptr(unsafe.Pointer(&value)), 4)
		if result != 0 {
			return syscall.Errno(result)
		}
	}
	return nil
}

func unregisterUninstaller() error {
	// Open the parent in the same view used by the x86 installer and x64 app.
	parent, err := createUserKey(`Software\Microsoft\Windows\CurrentVersion\Uninstall`)
	if err != nil {
		return err
	}
	defer closeUserKey(parent)
	name, _ := syscall.UTF16PtrFromString("ExcelBomb")
	result, _, _ := registryDLL.NewProc("RegDeleteKeyW").Call(uintptr(parent), uintptr(unsafe.Pointer(name)))
	if result != 0 && result != 2 {
		return syscall.Errno(result)
	}
	return nil
}

//go:uintptrescapes
func comMethod(object uintptr, index int, args ...uintptr) error {
	vtable := *(*uintptr)(unsafe.Pointer(object))
	method := (*[21]uintptr)(unsafe.Pointer(vtable))[index]
	parameters := append([]uintptr{object}, args...)
	result, _, _ := syscall.SyscallN(method, parameters...)
	if uint32(result)&0x80000000 != 0 {
		return fmt.Errorf("Windows Shell HRESULT 0x%x", result)
	}
	return nil
}

func comText(object uintptr, index int, value string, extra ...uintptr) error {
	text, err := syscall.UTF16PtrFromString(value)
	if err != nil {
		return err
	}
	err = comMethod(object, index, append([]uintptr{uintptr(unsafe.Pointer(text))}, extra...)...)
	runtime.KeepAlive(text)
	return err
}

func createDesktopShortcut(name, executable string) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	result, _, _ := oleDLL.NewProc("CoInitializeEx").Call(0, 2)
	if uint32(result)&0x80000000 != 0 {
		return fmt.Errorf("初始化桌面入口失败：0x%x", result)
	}
	defer oleDLL.NewProc("CoUninitialize").Call()
	suffix := [8]byte{0xc0, 0, 0, 0, 0, 0, 0, 0x46}
	class := syscall.GUID{Data1: 0x00021401, Data4: suffix}
	iid := syscall.GUID{Data1: 0x000214f9, Data4: suffix}
	var link uintptr
	result, _, _ = oleDLL.NewProc("CoCreateInstance").Call(uintptr(unsafe.Pointer(&class)), 0, 1, uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&link)))
	if uint32(result)&0x80000000 != 0 {
		return fmt.Errorf("创建桌面入口失败：0x%x", result)
	}
	defer comMethod(link, 2)
	for _, value := range []struct {
		method int
		text   string
	}{{20, executable}, {9, filepath.Dir(executable)}, {7, "ExcelBomb 本地 Excel 工作台"}} {
		if err := comText(link, value.method, value.text); err != nil {
			return err
		}
	}
	if err := comText(link, 17, executable, 0); err != nil {
		return err
	}
	persistIID := syscall.GUID{Data1: 0x0000010b, Data4: suffix}
	var persist uintptr
	if err := comMethod(link, 0, uintptr(unsafe.Pointer(&persistIID)), uintptr(unsafe.Pointer(&persist))); err != nil {
		return err
	}
	defer comMethod(persist, 2)
	return comText(persist, 6, name, 1)
}

func showInfo(message string) {
	title, _ := syscall.UTF16PtrFromString("ExcelBomb")
	body, _ := syscall.UTF16PtrFromString(message)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x40)
}

func installationDiagnostics() string {
	paths, err := userInstallPaths()
	if err != nil {
		return fmt.Sprintf("Installation paths unavailable: %v\r\n", err)
	}
	text := fmt.Sprintf("Installation: %s\r\nInstalled: %v\r\n", paths.directory, readInstallRecord(paths.directory) == nil)
	name, _ := syscall.UTF16PtrFromString(runKey)
	var key syscall.Handle
	result, _, _ := registryDLL.NewProc("RegOpenKeyExW").Call(syscall.HKEY_CURRENT_USER, uintptr(unsafe.Pointer(name)), 0, 1|registryAccess(), uintptr(unsafe.Pointer(&key)))
	if result != 0 {
		return text + fmt.Sprintf("Login startup: not registered / registry status %d\r\n", result)
	}
	defer closeUserKey(key)
	value, _ := syscall.UTF16PtrFromString("ExcelBomb")
	var kind uint32
	data := make([]uint16, 512)
	size := uint32(len(data) * 2)
	result, _, _ = registryDLL.NewProc("RegQueryValueExW").Call(uintptr(key), uintptr(unsafe.Pointer(value)), 0, uintptr(unsafe.Pointer(&kind)), uintptr(unsafe.Pointer(&data[0])), uintptr(unsafe.Pointer(&size)))
	if result != 0 {
		return text + fmt.Sprintf("Login startup: not registered / registry status %d\r\n", result)
	}
	command := syscall.UTF16ToString(data)
	expected, _ := startupCommand(filepath.Join(paths.directory, "ExcelBomb.exe"))
	return text + fmt.Sprintf("Login startup correct: %v\r\nLogin startup command: %s\r\n", command == expected, command)
}
