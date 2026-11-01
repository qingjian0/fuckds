//go:build !js || !wasm

package main

// Keep this directory discoverable by host go test ./....
// The actual command is built only for GOOS=js GOARCH=wasm.
func main() {}
