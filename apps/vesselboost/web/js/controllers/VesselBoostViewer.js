import { ViewerController } from '@neurodesk/webapp-components';
import { assertSameSpace, assertVolumeStackSpaces } from '../modules/spatial-file.js';

export class VesselBoostViewer extends ViewerController {
  async loadVolumeStack(entries) {
    if (entries?.length) assertVolumeStackSpaces(entries, 'Viewer volume stack');
    return super.loadVolumeStack(entries);
  }

  async loadOverlay(file, colormap = 'vesselboost', opacity = 0.5, options = {}) {
    try {
      if (this.currentBaseFile) assertSameSpace(this.currentBaseFile, file, `${options.stage || file.name} overlay`);
      return await super.loadOverlay(file, colormap, opacity, options);
    } catch (error) {
      this.updateOutput(`Error loading overlay: ${error.message}`);
      return false;
    }
  }
}
