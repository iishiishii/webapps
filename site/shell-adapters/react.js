export function reactAdapter(document) {
  return {
    headers: document.querySelectorAll('#root header, [data-neurodesk-top-bar-host], body > header'),
    overlays: [],
    utilities: document.querySelectorAll('[data-neurodesk-utility]'),
    managedLinks: document.querySelectorAll('[data-neurodesk-shell-link]'),
  };
}
