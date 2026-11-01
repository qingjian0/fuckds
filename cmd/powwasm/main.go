//go:build js && wasm

// powwasm exposes the repository's existing Go PoW solver to a Node worker.
// The algorithm implementation remains in the root pow package unchanged.
package main

import (
	"context"
	"time"
	"syscall/js"

	pow "deepseek-web-api"
)

var solveFunc js.Func

func main() {
	solveFunc = js.FuncOf(func(this js.Value, args []js.Value) any {
		result := js.Global().Get("Object").New()
		if len(args) < 4 {
			result.Set("error", "solvePow requires challenge, salt, expireAt and difficulty")
			return result
		}

		challenge := args[0].String()
		salt := args[1].String()
		expireAt := int64(args[2].Float())
		difficulty := int64(args[3].Float())

		started := time.Now()
		answer, err := pow.SolvePow(context.Background(), challenge, salt, expireAt, difficulty)
		result.Set("ms", float64(time.Since(started).Milliseconds()))
		if err != nil {
			result.Set("error", err.Error())
			return result
		}
		result.Set("answer", float64(answer))
		return result
	})

	js.Global().Set("solvePow", solveFunc)
	js.Global().Call("postMessage", "ready")
	select {}
}
