//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

func browserCandidates() []string {
	var result []string
	for _, root := range []string{os.Getenv("LOCALAPPDATA"), os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
		if root == "" {
			continue
		}
		for _, relative := range []string{`Google\Chrome\Application\chrome.exe`, `Microsoft\Edge\Application\msedge.exe`, `Mozilla Firefox\firefox.exe`} {
			name := filepath.Join(root, relative)
			if info, err := os.Stat(name); err == nil && !info.IsDir() {
				result = append(result, name)
			}
		}
	}
	return result
}

func openBrowser(url string) error {
	for _, name := range browserCandidates() {
		if err := exec.Command(name, url).Start(); err == nil {
			return nil
		}
	}
	verb, _ := syscall.UTF16PtrFromString("open")
	target, _ := syscall.UTF16PtrFromString(url)
	result, _, _ := syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW").Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), 0, 0, 1)
	if result <= 32 {
		return fmt.Errorf("无法打开浏览器。请手动使用 IE11 或兼容浏览器访问 %s", url)
	}
	return nil
}

func showError(message string) {
	title, _ := syscall.UTF16PtrFromString("ExcelBomb")
	body, _ := syscall.UTF16PtrFromString(message)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x10)
}
