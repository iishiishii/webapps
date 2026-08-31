import { mountImagingWorkspace } from '../../src/core/index.js';
import { FileIOController } from '../../src/file-io/index.js';
import { PipelineExecutor } from '../../src/inference/index.js';

const workspace = mountImagingWorkspace({ controls: '#controls', viewer: '#viewer', status: '#status', title: 'Basic Segmentation' });
const files = new FileIOController({ mode: 'simple' });
const executor = new PipelineExecutor({ workerUrl: './worker.js' });
globalThis.templateApp = { workspace, files, executor };
