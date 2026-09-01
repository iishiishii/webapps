export function imagingWorkspaceAdapter(document) {
  return {
    headers: document.querySelectorAll('.start-page > .start-header, nd-imaging-app-header, [data-neurodesk-top-bar-host]'),
    overlays: [],
    utilities: document.querySelectorAll('[data-neurodesk-utility]'),
    managedLinks: document.querySelectorAll('[data-neurodesk-shell-link]'),
  };
}
