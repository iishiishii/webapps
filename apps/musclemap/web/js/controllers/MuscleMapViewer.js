import { ViewerController } from '@neurodesk/webapp-components';
import { createUint8PreviewNiftiFile } from '@neurodesk/webapp-components/file-io';

const LARGE_VOLUME_BYTES = 256 * 1024 ** 2;
const COMPRESSED_VOLUME_BYTES = 100 * 1024 ** 2;

export class MuscleMapViewer extends ViewerController {
  constructor(options) {
    super(options);
    this.currentBaseDisplayFile = null;
    this.currentBaseDisplayMode = 'original';
  }

  async loadBaseVolume(file, options = {}) {
    let displayFile = await this.createBaseDisplayFile(file);
    let loaded = await super.loadBaseVolume(displayFile, options);
    if (!loaded && displayFile === file && this.isNiftiFile(file)) {
      this.updateOutput('Retrying viewer load with an 8-bit display preview...');
      displayFile = await this.createBaseDisplayFile(file, true);
      loaded = await super.loadBaseVolume(displayFile, options);
    }
    if (loaded) {
      this.currentBaseFile = file;
      this.currentBaseDisplayFile = displayFile;
      this.currentFile = file;
    }
    return loaded;
  }

  async createBaseDisplayFile(file, force = false) {
    this.currentBaseDisplayMode = 'original';
    if (!force && !this.shouldUseUint8Preview(file)) return file;
    this.updateOutput('Preparing an 8-bit display preview; segmentation will use the original NIfTI data.');
    const preview = await createUint8PreviewNiftiFile(file);
    this.currentBaseDisplayMode = 'uint8-preview';
    return preview.file;
  }

  shouldUseUint8Preview(file) {
    if (!this.isNiftiFile(file)) return false;
    return (file.size || 0) >= (file.name.toLowerCase().endsWith('.nii.gz') ? COMPRESSED_VOLUME_BYTES : LARGE_VOLUME_BYTES);
  }

  isNiftiFile(file) { return /\.nii(?:\.gz)?$/i.test(file?.name || ''); }
  isBasePreviewActive() { return this.currentBaseDisplayMode !== 'original' && this.currentBaseDisplayFile !== this.currentBaseFile; }
}
