import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_WASM = path.join(ROOT, 'bin', 'ds-pow.wasm');
const DEFAULT_WASM_EXEC = path.join(ROOT, 'runtime', 'wasm_exec.cjs');
const WORKER_URL = new URL('./pow-wasm-worker.mjs', import.meta.url);

export class AndroidPowSolver {
  constructor({ logger, wasmPath = DEFAULT_WASM, wasmExecPath = DEFAULT_WASM_EXEC, timeoutMs = 15_000 }) {
    this.log = logger;
    this.wasmPath = wasmPath;
    this.wasmExecPath = wasmExecPath;
    this.timeoutMs = timeoutMs;
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
    this.closed = false;
  }

  #ensureWorker() {
    if (this.closed) throw new Error('Android PoW 求解器已关闭');
    if (this.worker) return;

    const worker = new Worker(WORKER_URL, {
      workerData: { wasmPath: this.wasmPath, wasmExecPath: this.wasmExecPath },
    });
    this.worker = worker;

    worker.on('message', (message) => {
      if (message?.type === 'ready') {
        this.log?.debug('Android Go/WASM PoW worker ready');
        return;
      }
      if (message?.type === 'fatal') {
        this.#failWorker(new Error(message.error || 'Android PoW worker failed'));
        return;
      }
      const waiter = this.pending.get(message?.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error('PoW: ' + message.error));
      else waiter.resolve({ answer: message.answer, ms: message.ms });
    });
    worker.on('error', (error) => this.#failWorker(error));
    worker.on('exit', (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (!this.closed) this.#rejectPending(new Error('Android PoW worker exited: ' + code));
    });
  }

  #rejectPending(error) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  #failWorker(error) {
    const worker = this.worker;
    this.worker = null;
    this.#rejectPending(error);
    worker?.terminate().catch(() => {});
    this.log?.error('Android PoW worker failed:', error);
  }

  solve({ challenge, salt, expireAt, difficulty }) {
    this.#ensureWorker();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('PoW 求解超时'));
      }, this.timeoutMs);

      this.pending.set(id, {
        timer,
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.worker.postMessage({ id, challenge, salt, expireAt, difficulty });
    });
  }

  close() {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    this.#rejectPending(new Error('Android PoW 求解器已关闭'));
    worker?.terminate().catch(() => {});
  }
}
