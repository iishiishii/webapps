import { neurodeskViteConfig } from '../../scripts/lib/vite-app-config.mjs';

// Base path (registry: /surfannotate/), worker format and the COOP/COEP
// headers for dev AND preview come from the shared helper — vite preview does
// not read a _headers file, and the e2e smoke test checks the same origin
// isolation the dev server provides.
export default neurodeskViteConfig({
  appId: 'surfannotate',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048 // NiiVue is a single large chunk by design
  }
});
