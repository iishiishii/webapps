import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { loadAppsRegistry, repoRoot } from '../scripts/lib/apps-registry.mjs';

const dist = join(repoRoot, 'dist');

test('composite site contains one checksum-verified runtime store', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'runtime-assets', 'manifest.json'), 'utf8'));
  for (const family of manifest.families) {
    for (const file of family.files) {
      await access(join(dist, '_runtime', family.target, file.name));
    }
  }
});

test('only declared app-scoped runtime families remain in composite app copies', async () => {
  const registry = await loadAppsRegistry();
  for (const app of registry.apps) {
    const appDist = join(dist, app.path);
    await assert.rejects(access(join(appDist, 'dcm2niix')));
    await assert.rejects(access(join(appDist, 'nifti-js')));
    await assert.rejects(access(join(appDist, 'vendor', 'webapp-components')));
    try {
      const wasm = await readdir(join(appDist, 'wasm'));
      const ortFiles = wasm.filter((name) => name.startsWith('ort')).sort();
      if (app.app_scoped_runtime_families.includes('ort-web')) {
        assert.deepEqual(ortFiles, [
          'ort-wasm-simd-threaded.jsep.mjs',
          'ort-wasm-simd-threaded.jsep.wasm',
          'ort-wasm-simd-threaded.mjs',
          'ort-wasm-simd-threaded.wasm',
          'ort.webgpu.min.js',
        ]);
      } else {
        assert.deepEqual(ortFiles, [], `${app.id} retains app-local ORT files`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
});

test('composite references shared runtimes from the root store', async () => {
  const workers = [
    ['musclemap', 'js/inference-worker.js'],
    ['vesselboost', 'js/inference-worker.js'],
    ['sct', 'js/inference-worker.js'],
    ['calmar', 'js/inference-worker.js'],
    ['seedseg', 'js/inference-worker.js'],
  ];
  for (const [app, file] of workers) {
    const source = await readFile(join(dist, app, file), 'utf8');
    assert.match(source, /_runtime\/(?:ort-web|nifti-reader)\//, `${app} worker does not use shared runtime`);
    if (app === 'musclemap') {
      assert.match(source, /\.\.\/wasm\/ort\.webgpu\.min\.js/);
      assert.doesNotMatch(source, /_runtime\/ort-web/);
    }
  }
});
