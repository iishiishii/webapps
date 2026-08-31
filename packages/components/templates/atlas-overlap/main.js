import { mountImagingWorkspace } from '../../src/core/index.js';
import { PipelineExecutor } from '../../src/inference/index.js';

const workspace = mountImagingWorkspace({ controls: '#controls', viewer: '#viewer', status: '#status', title: 'Atlas Overlap' });
const executor = new PipelineExecutor({ workerUrl: './worker.js', steps: ['load', 'overlap'] });
globalThis.templateApp = { workspace, executor };
