package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testServer(t *testing.T) (*application, *httptest.Server) {
	t.Helper()
	server := httptest.NewUnstartedServer(nil)
	app, err := newApplication(server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	server.Config.Handler = app
	server.Start()
	t.Cleanup(server.Close)
	return app, server
}

func TestStaticAndHealth(t *testing.T) {
	_, server := testServer(t)
	for _, name := range []string{"/", "/worker.js", "/vendor/core-js-bundle.min.js", "/vendor/xlsx.full.min.js"} {
		response, err := http.Get(server.URL + name)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != 200 || len(data) == 0 {
			t.Fatal(name, response.StatusCode)
		}
		if response.Header.Get("X-UA-Compatible") != "IE=edge" {
			t.Fatal("missing standards header")
		}
		if name == "/" && (!strings.Contains(string(data), "excelbomb-session") || !strings.Contains(string(data), "© 2026 万晔")) {
			t.Fatal("missing HTML content")
		}
	}
	if !probe(strings.TrimPrefix(server.URL, "http://")) {
		t.Fatal("own service not recognized")
	}
}

func TestRejectHostOriginAndUploads(t *testing.T) {
	_, server := testServer(t)
	cases := []struct {
		method, path, host, origin string
		status                     int
	}{{"GET", "/", "attacker.example", "", 403}, {"GET", "/", "", "http://attacker.example", 403}, {"POST", "/", "", "", 405}, {"GET", "/../go.mod", "", "", 404}, {"GET", "/__excelbomb_quit", "", "", 405}, {"POST", "/__excelbomb_quit", "", "", 403}}
	for _, c := range cases {
		req, _ := http.NewRequest(c.method, server.URL+c.path, nil)
		if c.host != "" {
			req.Host = c.host
		}
		req.Header.Set("Origin", c.origin)
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != c.status {
			t.Fatalf("%s %s: got %d want %d", c.method, c.path, response.StatusCode, c.status)
		}
	}
}

func TestOwnStopAndAddress(t *testing.T) {
	app, server := testServer(t)
	stopped := make(chan bool, 1)
	app.onStop = func() { stopped <- true }
	if err := stopService(strings.TrimPrefix(server.URL, "http://")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("stop callback missing")
	}
	for _, addr := range []string{"0.0.0.0:8769", "example.com:8769", "127.0.0.1:80", "127.0.0.1:99999"} {
		if validAddress(addr) {
			t.Fatal("unsafe address", addr)
		}
	}
	if !validAddress("127.0.0.1:8769") {
		t.Fatal("default rejected")
	}
}

func TestPortConflictIsNotReused(t *testing.T) {
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "unrelated") }))
	defer other.Close()
	addr := strings.TrimPrefix(other.URL, "http://")
	if probe(addr) {
		t.Fatal("unrelated service accepted")
	}
	if err := run([]string{"-addr", addr, "-no-browser"}); err == nil {
		t.Fatal("port conflict was ignored")
	}
}
