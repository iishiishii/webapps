export function staticHtmlAdapter(document) {
  return {
    headers: document.querySelectorAll('[data-neurodesk-top-bar-host], .start-header, .app-header, nd-imaging-app-header, body > header'),
    overlays: document.querySelectorAll('[data-neurodesk-top-bar-overlay], #landingPage'),
    utilities: document.querySelectorAll('[data-neurodesk-utility]'),
  };
}
