//go:build !windows

package main

import (
	"fmt"
	"os"
)

func browserCandidates() []string  { return []string{"host test mode"} }
func openBrowser(url string) error { fmt.Println("Browser URL:", url); return nil }
func showError(message string)     { fmt.Fprintln(os.Stderr, message) }
