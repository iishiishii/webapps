import { vitePreviewPlaywrightConfig } from '../../test-utils/playwright-vite-preview.mjs';

// SwiftShader WebGL2 for headless Chromium on a GPU-less machine, and loopback
// exempted from any machine-wide http_proxy — both handled by the shared helper.
export default vitePreviewPlaywrightConfig({
  port: 4322,
  host: '127.0.0.1',
  basePath: '/surfannotate/',
  swiftShaderWebGL: true,
  exemptLoopbackFromProxy: true,
  viewport: { width: 1280, height: 800 },
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list'
});
