import { vitePreviewPlaywrightConfig } from '../../test-utils/playwright-vite-preview.mjs';

// Serve the BUILT output so COOP/COEP headers (public/_headers, applied by the host)
// and worker/wasm asset paths are exercised — not just the dev server.
export default vitePreviewPlaywrightConfig({ port: 4173 });
