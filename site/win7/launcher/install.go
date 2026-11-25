package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
)

const localAddress = "127.0.0.1:8769"
const installerFilename = "01-Install-ExcelBomb.exe"

func isInstallerExecutable(name string) bool {
	name = filepath.Base(name)
	return strings.EqualFold(name, installerFilename) || strings.EqualFold(name, "Install-ExcelBomb.exe")
}

// Keep the public package to three entries; resources live under Support.
// Older flat packages and direct --install from bin remain supported.
func installPayloadRoot(executable string) string {
	root := filepath.Dir(executable)
	if strings.EqualFold(filepath.Base(filepath.Dir(root)), "bin") {
		return filepath.Dir(filepath.Dir(root))
	}
	if info, err := os.Stat(filepath.Join(root, "Support", "bin")); err == nil && info.IsDir() {
		return filepath.Join(root, "Support")
	}
	return root
}

type installPaths struct{ directory, desktop string }
type installRecord struct {
	App          string `json:"app"`
	Version      string `json:"version"`
	Architecture string `json:"architecture"`
}

// The x86 installer runs on both OS architectures. Native OS detection, not
// environment variables, selects the installed executable.
func selectedExecutable(root string, is64 bool) (string, error) {
	arches := []string{"x86"}
	if is64 {
		arches = []string{"x64", "x86"}
	}
	for _, arch := range arches {
		name := filepath.Join(root, "bin", arch, "ExcelBomb.exe")
		data, err := os.ReadFile(name)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if err := validateExecutable(data, arch); err != nil {
			return "", fmt.Errorf("%s: %w", name, err)
		}
		return name, nil
	}
	return "", errors.New("安装文件不完整。请先右键 ZIP 选择“全部提取”，保持 Support 文件夹与 01-Install-ExcelBomb.exe 在同一目录，再双击安装程序。")
}

func validateExecutable(data []byte, arch string) error {
	if len(data) < 64 || string(data[:2]) != "MZ" {
		return errors.New("不是有效 Windows 程序")
	}
	offset := int(binary.LittleEndian.Uint32(data[60:64]))
	if offset < 64 || offset > len(data)-94 || string(data[offset:offset+4]) != "PE\x00\x00" {
		return errors.New("无效 PE 文件")
	}
	want := uint16(0x14c)
	magic := uint16(0x10b)
	if arch == "x64" {
		want = 0x8664
		magic = 0x20b
	}
	if binary.LittleEndian.Uint16(data[offset+4:]) != want || binary.LittleEndian.Uint16(data[offset+24:]) != magic {
		return errors.New("程序位数与安装目录不一致")
	}
	opt := offset + 24
	major, minor := binary.LittleEndian.Uint16(data[opt+48:]), binary.LittleEndian.Uint16(data[opt+50:])
	if major > 6 || (major == 6 && minor > 1) || binary.LittleEndian.Uint16(data[opt+68:]) != 2 {
		return errors.New("程序不兼容 Windows 7 GUI")
	}
	return nil
}

func startupCommand(executable string) (string, error) {
	if strings.ContainsAny(executable, "\"\r\n\x00") {
		return "", errors.New("无效安装路径")
	}
	command := `"` + executable + `" --autostart`
	if len(utf16.Encode([]rune(command))) > 260 {
		return "", errors.New("安装路径过长，无法注册 Windows 登录自启。")
	}
	return command, nil
}

func readInstallRecord(directory string) error {
	data, err := os.ReadFile(filepath.Join(directory, "install-info.json"))
	if err != nil {
		return err
	}
	var record installRecord
	if json.Unmarshal(data, &record) != nil || record.App != identity {
		return errors.New("未找到有效安装记录，不修改该目录。")
	}
	return nil
}

func copyFile(source, destination string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("安装文件必须是普通文件")
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.CreateTemp(filepath.Dir(destination), ".excelbomb-install-")
	if err != nil {
		return err
	}
	temporary := output.Name()
	defer os.Remove(temporary)
	if _, err = io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	if err = output.Close(); err != nil {
		return err
	}
	// Rename on Windows replaces an existing file; a live executable remains
	// locked, so wait for the old server to exit before replacing it.
	for i := 0; i < 40; i++ {
		err = os.Rename(temporary, destination)
		if err == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return err
}

func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(name string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("安装资源不能包含符号链接")
		}
		relative, err := filepath.Rel(source, name)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		return copyFile(name, target)
	})
}

func stopForInstall(addr string, refuseOther bool) error {
	if probeVersion(addr, false) {
		if err := stopService(addr); err != nil {
			return err
		}
		for i := 0; i < 60; i++ {
			if !probeVersion(addr, false) {
				return nil
			}
			time.Sleep(100 * time.Millisecond)
		}
		return errors.New("ExcelBomb 服务尚未退出，请稍后重试。")
	}
	if !refuseOther {
		return nil
	}
	connection, err := net.DialTimeout("tcp4", addr, 500*time.Millisecond)
	if err == nil {
		connection.Close()
		return errors.New("8769 端口被其他程序占用。请关闭占用程序后重试；安装器不会终止其他程序。")
	}
	return nil
}

func installForUser() error {
	paths, err := userInstallPaths()
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	root := installPayloadRoot(executable)
	if strings.EqualFold(filepath.Clean(root), filepath.Clean(paths.directory)) {
		return errors.New("请从完整解压的安装包运行 01-Install-ExcelBomb.exe。")
	}
	source, err := selectedExecutable(root, native64Bit())
	if err != nil {
		return err
	}
	installed := filepath.Join(paths.directory, "ExcelBomb.exe")
	if _, err = startupCommand(installed); err != nil {
		return err
	}
	if info, err := os.Stat(paths.directory); err == nil {
		if !info.IsDir() {
			return errors.New("安装目标不是目录")
		}
		entries, err := os.ReadDir(paths.directory)
		if err != nil {
			return err
		}
		if len(entries) > 0 {
			if err = readInstallRecord(paths.directory); err != nil {
				return fmt.Errorf("安装目录已有其他内容：%w", err)
			}
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err = stopForInstall(localAddress, true); err != nil {
		return err
	}
	if err = os.MkdirAll(paths.directory, 0755); err != nil {
		return err
	}
	if err = copyFile(source, installed); err != nil {
		return fmt.Errorf("复制程序失败：%w", err)
	}
	arch := "x86"
	if strings.EqualFold(filepath.Base(filepath.Dir(source)), "x64") {
		arch = "x64"
	}
	record, _ := json.MarshalIndent(installRecord{identity, version, arch}, "", "  ")
	if err = os.WriteFile(filepath.Join(paths.directory, "install-info.json"), record, 0644); err != nil {
		return err
	}
	for _, name := range []string{"README.txt", "ExcelBomb-Win7.html", "licenses", "test"} {
		path := filepath.Join(root, name)
		info, err := os.Stat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if info.IsDir() {
			err = copyTree(path, filepath.Join(paths.directory, name))
		} else {
			err = copyFile(path, filepath.Join(paths.directory, name))
		}
		if err != nil {
			return err
		}
	}
	if err = writeInstalledCommands(paths.directory); err != nil {
		return err
	}
	if err = createDesktopShortcut(filepath.Join(paths.desktop, "ExcelBomb.lnk"), installed); err != nil {
		return fmt.Errorf("创建桌面入口失败：%w", err)
	}
	if err = registerUninstaller(paths.directory); err != nil {
		return err
	}
	if err = setAutostart(installed, true); err != nil {
		return fmt.Errorf("设置登录自启失败：%w", err)
	}
	command := exec.Command(installed, "--no-browser")
	if err = command.Start(); err != nil {
		return err
	}
	command.Process.Release()
	ready := false
	for i := 0; i < 60; i++ {
		if probe(localAddress) {
			ready = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !ready {
		return errors.New("文件已安装并设置自启，但本地服务未能启动。请运行安装目录中的 Check-ExcelBomb.cmd 检查。")
	}
	if err = openBrowser("http://" + localAddress + "/"); err != nil {
		return err
	}
	showInfo("安装完成。\n\n安装位置：" + paths.directory + "\n已创建桌面 ExcelBomb 入口，并开启当前用户登录后后台自启。\n以后开机不会自动弹出网页，双击桌面入口即可使用。\n可在安装目录关闭自启，或在控制面板卸载。")
	return nil
}

func manageInstallation(enable, uninstall bool) error {
	paths, err := userInstallPaths()
	if err != nil {
		return err
	}
	if err = readInstallRecord(paths.directory); err != nil {
		return fmt.Errorf("请先一键安装：%w", err)
	}
	if uninstall {
		if err = stopForInstall(localAddress, false); err != nil {
			return err
		}
	}
	if err = setAutostart(filepath.Join(paths.directory, "ExcelBomb.exe"), enable && !uninstall); err != nil {
		return err
	}
	if uninstall {
		if err = os.Remove(filepath.Join(paths.desktop, "ExcelBomb.lnk")); err != nil && !os.IsNotExist(err) {
			return err
		}
		return unregisterUninstaller()
	}
	if enable {
		showInfo("已开启当前用户登录后后台自启。不会自动弹出网页。")
	} else {
		showInfo("已关闭登录自启。当前正在运行的服务仍可继续使用。")
	}
	return nil
}

func writeInstalledCommands(directory string) error {
	for name, args := range map[string]string{"Start-ExcelBomb.cmd": "", "Stop-ExcelBomb.cmd": "--stop", "Check-ExcelBomb.cmd": "--check", "Enable-Autostart.cmd": "--enable-autostart", "Disable-Autostart.cmd": "--disable-autostart"} {
		text := "@echo off\r\nsetlocal\r\ncd /d \"%~dp0\"\r\nstart \"\" \"%~dp0ExcelBomb.exe\" " + args + "\r\n"
		if err := os.WriteFile(filepath.Join(directory, name), []byte(text), 0644); err != nil {
			return err
		}
	}
	// CMD parses the final block before it removes this batch file. It first
	// waits for the native preparation command to exit, avoiding locked EXEs.
	text := "@echo off\r\nsetlocal\r\nset \"EXCELBOMB_REMOVE_DIR=%~dp0\"\r\ncd /d \"%TEMP%\"\r\nstart \"\" /wait \"%EXCELBOMB_REMOVE_DIR%ExcelBomb.exe\" --prepare-uninstall\r\nif errorlevel 1 (\r\n echo Uninstall preparation failed. No files were removed.\r\n pause\r\n exit /b 1\r\n)\r\n(\r\n rmdir /s /q \"%EXCELBOMB_REMOVE_DIR%\"\r\n if exist \"%EXCELBOMB_REMOVE_DIR%.\" (\r\n  echo ExcelBomb files are still in use. Please close ExcelBomb and try again.\r\n  pause\r\n  exit /b 1\r\n)\r\n echo ExcelBomb has been uninstalled. Your exported workbooks were not modified.\r\n pause\r\n)\r\n"
	return os.WriteFile(filepath.Join(directory, "Uninstall-ExcelBomb.cmd"), []byte(text), 0644)
}

func logStartupError(err error) {
	paths, pathErr := userInstallPaths()
	if pathErr != nil {
		return
	}
	directory := filepath.Join(paths.directory, "logs")
	if os.MkdirAll(directory, 0755) != nil {
		return
	}
	name := filepath.Join(directory, "startup.log")
	if info, e := os.Stat(name); e == nil && info.Size() > 1024*1024 {
		os.Remove(name)
	}
	file, e := os.OpenFile(name, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if e != nil {
		return
	}
	defer file.Close()
	fmt.Fprintf(file, "%s %s: %v\r\n", time.Now().Format(time.RFC3339), version, err)
}
