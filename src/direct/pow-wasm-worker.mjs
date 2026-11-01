import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('PoW wasm worker requires worker_threads');

const require = createRequire(import.meta.url);
globalThis.postMessage = (message) => parentPort.postMessage(message);

let solvePow;
let queue = Promise.resolve();

async function initialize() {
  require(workerData.wasmExecPath);
  const go = new globalThis.Go();
  const bytes = fs.readFileSync(workerData.wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance).catch((error) => {
    parentPort.postMessage({ type: 'fatal', error: error?.stack || String(error) });
  });

  // The Go main function publishes this callback before announcing readiness.
  while (typeof globalThis.solvePow !== 'function') {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  solvePow = globalThis.solvePow;
  parentPort.postMessage({ type: 'ready' });
}

const ready = initialize();

parentPort.on('message', (message) => {
  if (!message || message.type === 'ready') return;
  queue = queue.then(async () => {
    await ready;
    if (typeof solvePow !== 'function') throw new Error('PoW wasm runtime is not ready');
    const result = solvePow(message.challenge, message.salt, message.expireAt, message.difficulty);
    parentPort.postMessage({ id: message.id, ...result });
  }).catch((error) => {
    parentPort.postMessage({ id: message.id, error: error?.message || String(error) });
  });
});

ready.catch((error) => {
  parentPort.postMessage({ type: 'fatal', error: error?.stack || String(error) });
});
