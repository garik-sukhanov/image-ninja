#!/usr/bin/env node
// Downloads a background-removal ONNX model into build/vendor/models/ so it
// gets bundled into the packaged .app (see `extraResources` in package.json).
//
// Skipping this is fine: the app downloads the model on demand into userData
// the first time you press "Удалить фон автоматически". Pre-bundling only
// matters if you want the feature to work on a machine with no network.
//
// Usage: node scripts/prepare-model.mjs [u2netp|u2net|isnet] [--force]

import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REMBG_RELEASE = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0';

const MODELS = {
  u2netp: { file: 'u2netp.onnx', mb: 4.4 },
  u2net: { file: 'u2net.onnx', mb: 168 },
  isnet: { file: 'isnet-general-use.onnx', mb: 170 },
};

const id = process.argv.find((a) => MODELS[a]) ?? 'u2net';
const force = process.argv.includes('--force');
const spec = MODELS[id];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build', 'vendor', 'models');
const out = join(outDir, spec.file);

if (!force && existsSync(out)) {
  console.log(`${spec.file} already present (${(statSync(out).size / 1e6).toFixed(1)} MB) — use --force to re-download`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const url = `${REMBG_RELEASE}/${spec.file}`;
console.log(`downloading ${spec.file} (~${spec.mb} MB)`);

const res = await fetch(url);
if (!res.ok || !res.body) {
  console.error(`download failed: ${res.status} ${url}`);
  process.exit(1);
}

const total = Number(res.headers.get('content-length') ?? 0);
let received = 0;
let lastPrint = 0;

const source = Readable.fromWeb(res.body);
source.on('data', (chunk) => {
  received += chunk.length;
  const pct = total ? Math.floor((received / total) * 100) : 0;
  if (pct >= lastPrint + 5) {
    lastPrint = pct;
    process.stdout.write(`\r  ${pct}%`);
  }
});

const tmp = `${out}.part`;
try {
  await pipeline(source, createWriteStream(tmp));
  const { renameSync } = await import('node:fs');
  renameSync(tmp, out);
  process.stdout.write('\r  100%\n');
  console.log(`wrote ${out}`);
} catch (e) {
  rmSync(tmp, { force: true });
  console.error('\ndownload failed:', e.message);
  process.exit(1);
}
