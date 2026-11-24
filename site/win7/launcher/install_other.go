//go:build !windows

package main

import "errors"

func userInstallPaths() (installPaths, error) {
	return installPaths{}, errors.New("一键安装和登录自启仅用于 Windows。")
}
func native64Bit() bool                { return false }
func setAutostart(string, bool) error  { return errors.New("Windows registry unavailable on host") }
func registerUninstaller(string) error { return errors.New("Windows registry unavailable on host") }
func unregisterUninstaller() error     { return errors.New("Windows registry unavailable on host") }
func createDesktopShortcut(string, string) error {
	return errors.New("Windows Shell unavailable on host")
}
func showInfo(string) {}

func installationDiagnostics() string {
	return "Windows installation integration unavailable on host.\r\n"
}
