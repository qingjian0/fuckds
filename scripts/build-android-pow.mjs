#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'build', 'android-pow');
fs.mkdirSync(output, { recursive: true });

const go = process.env.GO_BIN || 'go';
const env = { ...process.env, GOOS: 'js', GOARCH: 'wasm', CGO_ENABLED: '0' };
const build = spawnSync(go, ['build', '-trimpath', '-o', path.join(output, 'ds-pow.wasm'), './cmd/powwasm'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const goroot = spawnSync(go, ['env', 'GOROOT'], { encoding: 'utf8' });
if (goroot.status !== 0) throw new Error('Unable to locate GOROOT');
const candidates = [
  path.join(goroot.stdout.trim(), 'lib', 'wasm', 'wasm_exec.js'),
  path.join(goroot.stdout.trim(), 'misc', 'wasm', 'wasm_exec.js'),
];
const wasmExec = candidates.find((candidate) => fs.existsSync(candidate));
if (!wasmExec) throw new Error('Go wasm_exec.js was not found in GOROOT');

fs.copyFileSync(wasmExec, path.join(output, 'wasm_exec.cjs'));
console.log('Built Android PoW WASM and copied the matching Go wasm_exec.js');
