import { findApp, loadAppsRegistry } from './apps-registry.mjs';

// The one production header policy for every deployable. The composite root
// `_headers` (scripts/build-site.mjs) serves COEP `credentialless`, so the
// standalone static dists (scripts/build-static.mjs) and Vite app bundles emit
// the same policy instead of drifting per-app copies of `require-corp`.
export const isolationHeaders = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'X-Content-Type-Options': 'nosniff',
});

// Cloudflare Pages `_headers` file with the same policy, for standalone dists.
// (Only the root file is honoured in the composite; these keep standalone
// bundles isolated the way the composite already is.)
export const headersFile = `/*\n${Object.entries(isolationHeaders)
  .map(([name, value]) => `  ${name}: ${value}`)
  .join('\n')}\n`;

function emitHeadersFile() {
  return {
    name: 'neurodesk-static-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile });
    },
  };
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function mergeConfig(defaults, overrides) {
  const merged = { ...defaults };
  for (const [key, override] of Object.entries(overrides)) {
    const current = merged[key];
    if (Array.isArray(current) && Array.isArray(override)) merged[key] = [...current, ...override];
    else if (isPlainObject(current) && isPlainObject(override)) merged[key] = mergeConfig(current, override);
    else merged[key] = override;
  }
  return merged;
}

// Shared Vite config for the bundled apps. Derives `base` from the app's
// registry `path` (apps are served below the composite site), applies the
// COOP/COEP isolation headers to the dev and preview servers, and ships the
// `_headers` file in the bundle. `WEBAPPS_BASE_PATH` still overrides the base
// to keep one-off preview builds portable; an explicit `base` override wins
// over the registry default (niimath's relative `./` keeps its standalone
// release zip hostable at any path). Everything else merges over the defaults
// (plugins concatenate). Vite accepts the returned promise as a config export.
export async function neurodeskViteConfig({ appId, base, ...overrides }) {
  const registry = await loadAppsRegistry();
  const app = findApp(registry, appId);
  return mergeConfig({
    base: process.env.WEBAPPS_BASE_PATH || base || `/${app.path}/`,
    worker: { format: 'es' },
    server: { headers: { ...isolationHeaders } },
    preview: { headers: { ...isolationHeaders } },
    plugins: [emitHeadersFile()],
  }, overrides);
}
