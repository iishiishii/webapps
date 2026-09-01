import { neurodeskViteConfig } from '../../scripts/lib/vite-app-config.mjs'

// Base path, worker format, COOP/COEP dev headers and the production _headers
// file come from the shared helper (registry path: /browserqc/).
export default neurodeskViteConfig({
  appId: 'browserqc',
  server: {
    open: '/index.html',
    port: 8091,
  },
  build: {
    target: 'esnext',
  },
  // Vite's dev dep-prebundler cannot resolve @niivue/dcm2niix's WASM worker
  // after it moves under .vite/deps. Keep that package as source in dev. The
  // niimath wrapper comes from the workspace runtime-support package, and Vite
  // resolves its worker assets from source during dev and build.
  optimizeDeps: {
    exclude: ['@niivue/dcm2niix'],
  },
})
