package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed web
var embedded embed.FS

const identity = "ExcelBomb-Win7"
const version = "1.1.4-win7"

type application struct {
	assets fs.FS
	addr   string
	token  string
	onStop func()
	once   sync.Once
}

func newApplication(addr string) (*application, error) {
	assets, err := fs.Sub(embedded, "web")
	if err != nil {
		return nil, err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	return &application{assets: assets, addr: addr, token: hex.EncodeToString(secret)}, nil
}

func (a *application) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-ExcelBomb", identity)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-UA-Compatible", "IE=edge")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	if r.Host != a.addr {
		http.Error(w, "Invalid host", http.StatusForbidden)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+a.addr {
		http.Error(w, "Invalid origin", http.StatusForbidden)
		return
	}
	if r.URL.Path == "/__excelbomb_quit" {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		if r.Header.Get("X-ExcelBomb-Token") != a.token {
			http.Error(w, "Invalid token", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.WriteString(w, "ExcelBomb stopped")
		a.once.Do(func() {
			if a.onStop != nil {
				go func() { time.Sleep(100 * time.Millisecond); a.onStop() }()
			}
		})
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Read-only local service", http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path == "/__excelbomb_health" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if r.Method != http.MethodHead {
			json.NewEncoder(w).Encode(map[string]string{"app": identity, "version": version, "arch": runtime.GOARCH})
		}
		return
	}
	if strings.Contains(r.URL.Path, "\\") {
		http.NotFound(w, r)
		return
	}
	for _, part := range strings.Split(r.URL.Path, "/") {
		if part == ".." {
			http.NotFound(w, r)
			return
		}
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "." || name == "" {
		name = "index.html"
	}
	if strings.HasPrefix(name, "__") {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(a.assets, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	contentType := "application/octet-stream"
	switch path.Ext(name) {
	case ".html":
		contentType = "text/html; charset=utf-8"
		marker := []byte(`<head><meta name="excelbomb-session" content="` + a.token + `">`)
		data = bytes.Replace(data, []byte("<head>"), marker, 1)
	case ".js":
		contentType = "application/javascript; charset=utf-8"
	case ".css":
		contentType = "text/css; charset=utf-8"
	case ".svg":
		contentType = "image/svg+xml"
	case ".txt", ".md":
		contentType = "text/plain; charset=utf-8"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(data)
	}
}

func client() *http.Client {
	return &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil}}
}

func probe(addr string) bool {
	return probeVersion(addr, true)
}

// Upgrades may stop an older ExcelBomb, but never an unrelated local service.
func probeVersion(addr string, currentVersion bool) bool {
	response, err := client().Get("http://" + addr + "/__excelbomb_health")
	if err != nil {
		return false
	}
	defer response.Body.Close()
	var status struct {
		App     string `json:"app"`
		Version string `json:"version"`
	}
	return response.StatusCode == 200 && response.Header.Get("X-ExcelBomb") == identity && json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&status) == nil && status.App == identity && (!currentVersion || status.Version == version)
}

var tokenPattern = regexp.MustCompile(`<meta name="excelbomb-session" content="([a-f0-9]{64})">`)

func stopService(addr string) error {
	if !probeVersion(addr, false) {
		return errors.New("未找到正在运行的 ExcelBomb Win7 服务。")
	}
	response, err := client().Get("http://" + addr + "/")
	if err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 65536))
	response.Body.Close()
	if err != nil {
		return err
	}
	match := tokenPattern.FindSubmatch(data)
	if len(match) != 2 {
		return errors.New("无法验证本地服务，请手动关闭 ExcelBomb 进程。")
	}
	req, _ := http.NewRequest(http.MethodPost, "http://"+addr+"/__excelbomb_quit", nil)
	req.Header.Set("X-ExcelBomb-Token", string(match[1]))
	response, err = client().Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return errors.New("关闭本地服务失败。")
	}
	return nil
}

func validAddress(addr string) bool {
	host, port, err := net.SplitHostPort(addr)
	n, e := strconv.Atoi(port)
	return err == nil && e == nil && host == "127.0.0.1" && n >= 1024 && n <= 65535
}

func diagnostics(addr string) error {
	text := fmt.Sprintf("ExcelBomb Win7 diagnostics\r\nVersion: %s\r\nBuild: %s\r\nArchitecture: %s\r\nAddress: %s\r\nOwn service available: %v\r\nBrowser candidates: %s\r\n%s\r\nNative Windows 7/IE11 verification must be completed on the target PC.\r\nNo workbook data is included.\r\n", version, runtime.Version(), runtime.GOARCH, addr, probe(addr), strings.Join(browserCandidates(), "; "), installationDiagnostics())
	executable, _ := os.Executable()
	directory := filepath.Dir(executable)
	if strings.EqualFold(filepath.Base(filepath.Dir(directory)), "bin") {
		directory = filepath.Dir(filepath.Dir(directory))
	}
	name := filepath.Join(directory, "ExcelBomb-Diagnostics.txt")
	if err := os.WriteFile(name, append([]byte{0xef, 0xbb, 0xbf}, []byte(text)...), 0644); err != nil {
		return err
	}
	return nil
}

func run(args []string) error {
	flags := flag.NewFlagSet("ExcelBomb", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	addr := flags.String("addr", "127.0.0.1:8769", "local loopback address")
	noBrowser := flags.Bool("no-browser", false, "do not open browser")
	stop := flags.Bool("stop", false, "stop own local service")
	check := flags.Bool("check", false, "write diagnostics")
	install := flags.Bool("install", false, "install for current user and enable logon startup")
	enable := flags.Bool("enable-autostart", false, "enable logon startup for installed application")
	disable := flags.Bool("disable-autostart", false, "disable logon startup")
	uninstall := flags.Bool("prepare-uninstall", false, "stop service and remove installation integrations")
	autostart := flags.Bool("autostart", false, "start silently at user logon")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if !validAddress(*addr) {
		return errors.New("只允许使用 127.0.0.1 本机地址和有效端口。")
	}
	if *install || isInstallerExecutable(os.Args[0]) {
		return installForUser()
	}
	if *enable || *disable || *uninstall {
		return manageInstallation(*enable, *uninstall)
	}
	if *autostart {
		*noBrowser = true
	}
	if *check {
		return diagnostics(*addr)
	}
	if *stop {
		return stopService(*addr)
	}
	listener, err := net.Listen("tcp4", *addr)
	if err != nil {
		if probe(*addr) {
			if !*noBrowser {
				return openBrowser("http://" + *addr + "/")
			}
			return nil
		}
		return fmt.Errorf("本地端口 %s 已被其他程序占用，ExcelBomb 未启动。请关闭占用程序后重试。", *addr)
	}
	app, err := newApplication(*addr)
	if err != nil {
		listener.Close()
		return err
	}
	stopChannel := make(chan struct{}, 1)
	app.onStop = func() { stopChannel <- struct{}{} }
	server := &http.Server{Handler: app, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 32768}
	serveErrors := make(chan error, 1)
	go func() { serveErrors <- server.Serve(listener) }()
	if !*noBrowser {
		if err := openBrowser("http://" + *addr + "/"); err != nil {
			server.Close()
			return err
		}
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	defer signal.Stop(signals)
	select {
	case err = <-serveErrors:
		if err != http.ErrServerClosed {
			return err
		}
	case <-stopChannel:
	case <-signals:
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return server.Shutdown(ctx)
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		quiet := false
		for _, arg := range os.Args[1:] {
			if arg == "--autostart" || arg == "-autostart" {
				quiet = true
			}
		}
		if quiet {
			logStartupError(err)
		} else {
			showError(err.Error())
		}
		os.Exit(1)
	}
}
