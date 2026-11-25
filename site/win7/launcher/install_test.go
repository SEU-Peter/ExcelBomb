package main

import (
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixturePE(arch string) []byte {
	data := make([]byte, 512)
	copy(data, "MZ")
	binary.LittleEndian.PutUint32(data[60:], 128)
	copy(data[128:], "PE\x00\x00")
	machine, magic := uint16(0x14c), uint16(0x10b)
	if arch == "x64" {
		machine = 0x8664
		magic = 0x20b
	}
	binary.LittleEndian.PutUint16(data[132:], machine)
	binary.LittleEndian.PutUint16(data[152:], magic)
	binary.LittleEndian.PutUint16(data[200:], 6)
	binary.LittleEndian.PutUint16(data[202:], 1)
	binary.LittleEndian.PutUint16(data[220:], 2)
	return data
}

func TestOrganizedAndLegacyPackageEntrypoints(t *testing.T) {
	root := filepath.Join(t.TempDir(), "中文 安装目录")
	payload := filepath.Join(root, "Support")
	if err := os.MkdirAll(filepath.Join(payload, "bin", "x86"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, executable := range []string{filepath.Join(root, "01-Install-ExcelBomb.exe"), filepath.Join(payload, "bin", "x86", "ExcelBomb.exe")} {
		if got := installPayloadRoot(executable); got != payload {
			t.Fatalf("%s: got %s", executable, got)
		}
	}
	legacy := t.TempDir()
	if got := installPayloadRoot(filepath.Join(legacy, "Install-ExcelBomb.exe")); got != legacy {
		t.Fatal("legacy layout rejected", got)
	}
	for _, name := range []string{"01-Install-ExcelBomb.exe", "01-INSTALL-EXCELBOMB.EXE", "Install-ExcelBomb.exe"} {
		if !isInstallerExecutable(filepath.Join(root, name)) {
			t.Fatal("installer entry not recognized", name)
		}
	}
	if isInstallerExecutable(filepath.Join(payload, "bin", "x86", "ExcelBomb.exe")) {
		t.Fatal("portable app mistaken for installer")
	}
	if _, err := selectedExecutable(installPayloadRoot(filepath.Join(root, installerFilename)), false); err == nil {
		t.Fatal("organized package missing the actual binary was accepted")
	}
}

func TestInstallerArchitectureSelection(t *testing.T) {
	root := filepath.Join(t.TempDir(), "中文 安装 & 路径")
	for _, arch := range []string{"x86", "x64"} {
		folder := filepath.Join(root, "bin", arch)
		if err := os.MkdirAll(folder, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(folder, "ExcelBomb.exe"), fixturePE(arch), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range []struct {
		os64 bool
		want string
	}{{false, "x86"}, {true, "x64"}} {
		got, err := selectedExecutable(root, c.os64)
		if err != nil || filepath.Base(filepath.Dir(got)) != c.want {
			t.Fatal(got, err, c.want)
		}
	}
	os.RemoveAll(filepath.Join(root, "bin", "x64"))
	got, err := selectedExecutable(root, true)
	if err != nil || filepath.Base(filepath.Dir(got)) != "x86" {
		t.Fatal("x86-only package should work on 64-bit OS", got, err)
	}
	os.RemoveAll(filepath.Join(root, "bin", "x86"))
	if _, err := selectedExecutable(root, false); err == nil {
		t.Fatal("incomplete package accepted")
	}
}

func TestInstallerRejectsWrongPEAndNewerSubsystem(t *testing.T) {
	if validateExecutable(fixturePE("x64"), "x86") == nil {
		t.Fatal("64-bit binary accepted for x86")
	}
	data := fixturePE("x86")
	binary.LittleEndian.PutUint16(data[200:], 10)
	if validateExecutable(data, "x86") == nil {
		t.Fatal("newer Windows subsystem accepted")
	}
	for _, bad := range [][]byte{nil, []byte("not an exe"), make([]byte, 64)} {
		if validateExecutable(bad, "x86") == nil {
			t.Fatal("corrupt PE accepted")
		}
	}
}

func TestAutostartQuotesAndPathLimit(t *testing.T) {
	path := `C:\Users\万晔 & Test\AppData\Local\ExcelBomb\ExcelBomb.exe`
	command, err := startupCommand(path)
	if err != nil || command != `"`+path+`" --autostart` {
		t.Fatal(command, err)
	}
	for _, bad := range []string{`C:\bad"path.exe`, "bad\npath", strings.Repeat("x", 260)} {
		if _, err := startupCommand(bad); err == nil {
			t.Fatal("invalid startup command accepted")
		}
	}
}

func TestInstallCopyUpdateAndUninstallCommands(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "原始 文件")
	target := filepath.Join(root, "安装 文件")
	os.WriteFile(source, []byte("first"), 0644)
	if err := copyFile(source, target); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(source, []byte("updated"), 0644)
	if err := copyFile(source, target); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(target)
	if string(data) != "updated" {
		t.Fatal("update not copied")
	}
	if err := readInstallRecord(root); err == nil {
		t.Fatal("unowned directory accepted")
	}
	os.WriteFile(filepath.Join(root, "install-info.json"), []byte(`{"app":"OtherApp"}`), 0644)
	if readInstallRecord(root) == nil {
		t.Fatal("foreign app accepted")
	}
	os.WriteFile(filepath.Join(root, "install-info.json"), []byte(`{"app":"ExcelBomb-Win7"}`), 0644)
	if err := readInstallRecord(root); err != nil {
		t.Fatal(err)
	}
	if err := writeInstalledCommands(root); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"Start-ExcelBomb.cmd", "Stop-ExcelBomb.cmd", "Check-ExcelBomb.cmd", "Enable-Autostart.cmd", "Disable-Autostart.cmd", "Uninstall-ExcelBomb.cmd"} {
		text, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		for _, b := range text {
			if b > 127 {
				t.Fatal("non-ASCII batch file", name)
			}
		}
		if strings.Contains(strings.ReplaceAll(string(text), "\r\n", ""), "\n") {
			t.Fatal("non-CRLF batch file", name)
		}
	}
	uninstall, _ := os.ReadFile(filepath.Join(root, "Uninstall-ExcelBomb.cmd"))
	text := string(uninstall)
	if strings.Index(text, "--prepare-uninstall") > strings.Index(text, "rmdir /s") || !strings.Contains(text, "if errorlevel 1") || !strings.Contains(text, `cd /d "%TEMP%"`) {
		t.Fatal("unsafe uninstall sequencing")
	}
	if !strings.Contains(text, `start "" /wait`) || !strings.Contains(text, `if exist "%EXCELBOMB_REMOVE_DIR%."`) {
		t.Fatal("uninstall must wait for native preparation and check remaining directory")
	}
}

func TestUpgradeRecognizesOlderService(t *testing.T) {
	app, server := testServer(t)
	server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__excelbomb_health" {
			w.Header().Set("X-ExcelBomb", identity)
			w.Write([]byte(`{"app":"ExcelBomb-Win7","version":"1.1.0-win7"}`))
			return
		}
		app.ServeHTTP(w, r)
	})
	addr := strings.TrimPrefix(server.URL, "http://")
	if probe(addr) || !probeVersion(addr, false) {
		t.Fatal("old service should be recognized for upgrade, not reused as current")
	}
	if err := stopService(addr); err != nil {
		t.Fatal("old service stop rejected", err)
	}
}

func TestUninstallLeavesUnrelatedPortAlone(t *testing.T) {
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("OtherApp")) }))
	defer other.Close()
	addr := strings.TrimPrefix(other.URL, "http://")
	if stopForInstall(addr, true) == nil {
		t.Fatal("installer ignored occupied port")
	}
	if err := stopForInstall(addr, false); err != nil {
		t.Fatal("uninstall should not touch or depend on unrelated server", err)
	}
}
