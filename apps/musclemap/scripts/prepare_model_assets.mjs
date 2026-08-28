#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, '..');
const release = JSON.parse(await readFile(join(appDir, 'model-sources', 'release.json'), 'utf8'));
const forceDownload = process.argv.includes('--force-download');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function verify(bytes, expected, name) {
  if (bytes.byteLength !== expected.bytes) {
    throw new Error(`${name} has ${bytes.byteLength} bytes, expected ${expected.bytes}`);
  }
  const digest = sha256(bytes);
  if (digest !== expected.sha256) throw new Error(`${name} SHA-256 mismatch`);
}

async function loadModel(model) {
  const filename = basename(new URL(model.asset.url).pathname);
  const stageDir = join(appDir, '.tmp_model_release', model.labelSpaceId.replace('musclemap-', ''));
  const stagedPath = join(stageDir, filename);
  if (!forceDownload) {
    try {
      const bytes = await readFile(stagedPath);
      verify(bytes, model.asset, filename);
      return bytes;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  process.stdout.write(`Downloading ${filename} for same-origin deployment parts...\n`);
  const response = await fetch(model.asset.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Failed to download ${filename}: ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verify(bytes, model.asset, filename);
  await mkdir(stageDir, { recursive: true });
  await writeFile(stagedPath, bytes);
  return bytes;
}

const partitionedModels = release.models.filter(model =>
  (model.status === 'active' || model.status === 'legacy') && model.asset?.parts
);
const outputDir = join(appDir, 'web', 'models');
await mkdir(outputDir, { recursive: true });

for (const model of partitionedModels) {
  const bytes = await loadModel(model);
  let offset = 0;
  for (const part of model.asset.parts) {
    const partBytes = bytes.subarray(offset, offset + part.bytes);
    verify(partBytes, part, part.path);
    await writeFile(join(appDir, 'web', part.path), partBytes);
    offset += part.bytes;
  }
  if (offset !== bytes.byteLength) throw new Error(`${model.id} deployment parts did not consume the model`);
  process.stdout.write(`Prepared ${model.asset.parts.length} verified deployment parts for ${model.labelSpaceId}.\n`);
}
