import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AndroidPowSolver } from '../src/direct/pow-android.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = path.join(root, 'build', 'android-pow', 'ds-pow.wasm');
const wasmExecPath = path.join(root, 'build', 'android-pow', 'wasm_exec.cjs');
const built = fs.existsSync(wasmPath) && fs.existsSync(wasmExecPath);

test('Android Go/WASM adapter matches the existing Go known-answer vector', { skip: !built }, async () => {
  const solver = new AndroidPowSolver({ wasmPath, wasmExecPath });
  try {
    const result = await solver.solve({
      challenge: 'd4a2ea58c89e40887c933484868380c6f803eaa8dc53a3b9df8e431b921a4f09',
      salt: 'testsalt',
      expireAt: 1700000000,
      difficulty: 1000,
    });
    assert.equal(result.answer, 42);
    assert.ok(Number.isFinite(result.ms));
  } finally {
    solver.close();
  }
});

test('Android Go/WASM adapter serializes concurrent solve requests safely', { skip: !built }, async () => {
  const solver = new AndroidPowSolver({ wasmPath, wasmExecPath });
  try {
    const [zero, fortyTwo] = await Promise.all([
      solver.solve({
        challenge: 'b1f454f08e385082024f1ee8155c11dd1bb9eb772c8102904d7d4e462d0b77ed',
        salt: 'testsalt',
        expireAt: 1700000000,
        difficulty: 1000,
      }),
      solver.solve({
        challenge: 'd4a2ea58c89e40887c933484868380c6f803eaa8dc53a3b9df8e431b921a4f09',
        salt: 'testsalt',
        expireAt: 1700000000,
        difficulty: 1000,
      }),
    ]);
    assert.equal(zero.answer, 0);
    assert.equal(fortyTwo.answer, 42);
  } finally {
    solver.close();
  }
});

test('Android Go/WASM adapter solves the full default 144k search range', { skip: !built }, async () => {
  const solver = new AndroidPowSolver({ wasmPath, wasmExecPath, timeoutMs: 30_000 });
  try {
    const result = await solver.solve({
      challenge: '71caafc3dddc540beac8e8c885beeaf52558e8cb309b53c2cc312ccb2969d8cf',
      salt: 'testsalt',
      expireAt: 1700000000,
      difficulty: 144000,
    });
    assert.equal(result.answer, 143999);
    assert.ok(result.ms < 30_000);
  } finally {
    solver.close();
  }
});
