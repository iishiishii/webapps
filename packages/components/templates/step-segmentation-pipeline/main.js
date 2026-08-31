import { mountImagingWorkspace } from '../../src/core/index.js';
import { PipelineExecutor } from '../../src/inference/index.js';

const workspace = mountImagingWorkspace({ controls: '#controls', viewer: '#viewer', status: '#status', title: 'Step Pipeline' });
const executor = new PipelineExecutor({ workerUrl: './worker.js', steps: ['load', 'preprocess', 'inference'] });
globalThis.templateApp = { workspace, executor };
