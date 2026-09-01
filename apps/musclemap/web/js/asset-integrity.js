(function installMuscleMapAssetIntegrity(root) {
  async function sha256Hex(buffer) {
    const digest = await root.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function verifyAssetBuffer(buffer, asset) {
    if (!asset || !Number.isInteger(asset.bytes) || !/^[0-9a-f]{64}$/.test(asset.sha256 || '')) {
      throw new Error('Model asset integrity metadata is missing or invalid');
    }
    if (!(buffer instanceof ArrayBuffer)) throw new Error('Model asset must be an ArrayBuffer');
    if (buffer.byteLength !== asset.bytes) {
      throw new Error(`Model asset has ${buffer.byteLength} bytes; expected ${asset.bytes}`);
    }
    const actualSha256 = await sha256Hex(buffer);
    if (actualSha256 !== asset.sha256) {
      throw new Error(`Model asset SHA-256 mismatch: ${actualSha256}`);
    }
    return buffer;
  }

  root.MuscleMapAssetIntegrity = { sha256Hex, verifyAssetBuffer };
})(globalThis);
