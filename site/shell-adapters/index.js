import { imagingWorkspaceAdapter } from './imaging-workspace.js';
import { reactAdapter } from './react.js';
import { staticHtmlAdapter } from './static-html.js';

const adapters = { 'static-html': staticHtmlAdapter, 'imaging-workspace': imagingWorkspaceAdapter, react: reactAdapter };

export function resolveShellAdapter(shell, document) {
  const adapter = adapters[shell];
  if (!adapter) throw new Error(`Unsupported shell adapter: ${shell}`);
  return adapter(document);
}
