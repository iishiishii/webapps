import { mountImagingWorkspace } from '../../src/core/index.js';
import { FileIOController } from '../../src/file-io/index.js';
import { generateQsmxtCommand } from '../../src/qsm/index.js';

const workspace = mountImagingWorkspace({ controls: '#controls', viewer: '#viewer', status: '#status', title: 'QSM Pipeline' });
const files = new FileIOController({ mode: 'bucketed' });
const command = generateQsmxtCommand({ dipoleInversion: 'tv', tv: { lambda: 0.01 } });
globalThis.templateApp = { workspace, files, command };
