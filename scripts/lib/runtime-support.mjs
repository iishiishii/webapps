import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function isUrlWithinServiceWorkerScope(serviceWorkerUrl, assetUrl) {
  const worker = new URL(serviceWorkerUrl);
  const scope = new URL('./', worker);
  const asset = new URL(assetUrl, scope);
  return asset.origin === scope.origin && asset.pathname.startsWith(scope.pathname);
}

export async function writeCoiServiceWorker({ repoRoot, destination, config }) {
  const source = await readFile(
    join(repoRoot, 'packages', 'runtime-support', 'src', 'coi-serviceworker.js'),
    'utf8',
  );
  const options = config === true ? {} : config;
  const rendered = source.replace('/*__COI_RUNTIME_CONFIG__*/ {}', JSON.stringify(options));
  if (rendered === source) throw new Error('COI service-worker configuration marker is missing');
  await writeFile(destination, rendered);
}
