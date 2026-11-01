import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'android/app/src/main/assets/engine');

const required = ['src/index.mjs', 'src/config.mjs', 'web/index.html', 'web/app.js', 'web/app.css'];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Required engine asset missing: ${file}`);
}
if (!fs.existsSync(path.join(root, 'node_modules/playwright/package.json'))) {
  throw new Error('Production dependencies are missing. Run npm install --omit=dev first.');
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });

for (const entry of ['src', 'web', 'package.json']) {
  fs.cpSync(path.join(root, entry), path.join(target, entry), {
    recursive: true,
    dereference: false,
    filter: (source) => {
      const relative = path.relative(root, source).replaceAll(path.sep, '/');
      return !relative.startsWith('node_modules/.cache/') &&
        !relative.includes('/test/') &&
        !relative.endsWith('.map');
    }
  });
}

for (const dependency of ['playwright', 'playwright-core']) {
  const source = path.join(root, 'node_modules', dependency);
  if (!fs.existsSync(source)) throw new Error('Required dependency missing: ' + dependency);
  fs.cpSync(source, path.join(target, 'node_modules', dependency), { recursive: true });
}

const powBuild = path.join(root, 'build', 'android-pow');
for (const [source, destination] of [
  [path.join(powBuild, 'ds-pow.wasm'), path.join(target, 'bin', 'ds-pow.wasm')],
  [path.join(powBuild, 'wasm_exec.cjs'), path.join(target, 'runtime', 'wasm_exec.cjs')],
]) {
  if (!fs.existsSync(source)) throw new Error('Android PoW build output missing: ' + source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

if (!fs.existsSync(path.join(target, 'src/index.mjs'))) throw new Error('Asset copy did not include src/index.mjs');
console.log(`Prepared engine assets at ${path.relative(root, target)}`);
