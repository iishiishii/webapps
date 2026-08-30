import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { assembleRuntimeAssetStore } from '../scripts/lib/runtime-assets.mjs';

test('composite rewrite gives ONNX Runtime an absolute WASM base URL', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-assets-rewrite-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const sourceRoot = new URL('../apps/', import.meta.url);
  const repoRoot = join(root, 'repo');
  const siteDist = join(root, 'site');
  const apps = [
    { id: 'musclemap', path: 'musclemap', app_scoped_runtime_families: ['ort-web'] },
    { id: 'vesselboost', path: 'vesselboost' },
    { id: 'spinalcordtoolbox', path: 'sct' },
    { id: 'calmar', path: 'calmar' },
    { id: 'seedseg', path: 'seedseg' },
  ];
  const loaders = [
    { name: 'ort.webgpu.min.js', sourceApp: 'musclemap' },
    { name: 'ort.webgpu.bundle.min.mjs', sourceApp: 'calmar' },
    { name: 'ort.min.js', sourceApp: 'seedseg' },
  ];

  await mkdir(join(repoRoot, 'runtime-assets'), { recursive: true });
  await mkdir(join(repoRoot, 'packages', 'components', 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'packages', 'components', 'src', 'index.js'), '');

  for (const app of apps) {
    const appDist = join(siteDist, app.path);
    await mkdir(join(appDist, 'js'), { recursive: true });
    const worker = await readFile(new URL(`${app.id}/web/js/inference-worker.js`, sourceRoot), 'utf8');
    await writeFile(join(appDist, 'js', 'inference-worker.js'), worker);
  }

  for (const loader of loaders) {
    const loaderDir = join(siteDist, apps.find((app) => app.id === loader.sourceApp).path, 'wasm');
    await mkdir(loaderDir, { recursive: true });
    await writeFile(join(loaderDir, loader.name), `placeholder ${loader.name}`);
  }

  await writeFile(join(repoRoot, 'runtime-assets', 'manifest.json'), JSON.stringify({
    schema_version: 1,
    families: [{
      id: 'ort-web',
      version: '1.21.0',
      target: 'ort-web/1.21.0',
      files: loaders.map((loader) => ({
        name: loader.name,
        source_app: loader.sourceApp,
        source: `wasm/${loader.name}`,
        sha256: createHash('sha256').update(`placeholder ${loader.name}`).digest('hex'),
      })),
    }],
  }));

  await assembleRuntimeAssetStore({
    repoRoot,
    siteDist,
    registry: { apps },
  });

  for (const app of apps) {
    const worker = await readFile(join(siteDist, app.path, 'js', 'inference-worker.js'), 'utf8');
    if (app.id === 'musclemap') {
      assert.match(worker, /\.\.\/wasm\/ort/);
      assert.doesNotMatch(worker, /_runtime\/ort-web/);
      await readFile(join(siteDist, app.path, 'wasm', 'ort.webgpu.min.js'));
    } else {
      assert.match(worker, /\.\.\/\.\.\/_runtime\/ort-web\/1\.21\.0\/ort/);
    }

    const assignment = worker.match(/ort\.env\.wasm\.wasmPaths\s*=\s*[^;]+;/)?.[0];
    assert.ok(assignment, `${app.id} worker is missing its wasmPaths assignment`);

    for (const [workerUrl, expectedRuntimeUrl] of [
      [
        `https://example.test/${app.path}/js/inference-worker.js`,
        app.id === 'musclemap'
          ? 'https://example.test/musclemap/wasm/'
          : 'https://example.test/_runtime/ort-web/1.21.0/',
      ],
      [
        `https://example.test/webapps/${app.path}/js/inference-worker.js`,
        app.id === 'musclemap'
          ? 'https://example.test/webapps/musclemap/wasm/'
          : 'https://example.test/webapps/_runtime/ort-web/1.21.0/',
      ],
    ]) {
      const context = {
        ort: { env: { wasm: {} } },
        self: { location: { href: workerUrl } },
        URL,
      };
      vm.runInNewContext(assignment, context);
      assert.equal(context.ort.env.wasm.wasmPaths, expectedRuntimeUrl, app.id);
      assert.doesNotMatch(context.ort.env.wasm.wasmPaths, /_runtime\/_runtime/, app.id);
    }
  }
});
