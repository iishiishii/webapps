import { staticAppPlaywrightConfig } from '../../test-utils/playwright-static-app.mjs';

// Serve web/ with COOP/COEP (via run.sh) after vendoring the shared components, so the
// harness exercises the real import map + vendored files in a browser.
export default staticAppPlaywrightConfig({ port: 4318 });
