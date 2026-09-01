import { PipelineExecutor } from '@neurodesk/webapp-components';

export class SeedSegPipeline extends PipelineExecutor {
  constructor(options = {}) {
    super({
      ...options,
      workerUrl: 'js/inference-worker.js',
      workerType: 'module',
      steps: [],
    });
  }
}
