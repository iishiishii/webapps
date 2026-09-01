import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { verifyMuscleMapFullPipeline } from '../../../test/musclemap-full-pipeline-smoke.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('processes a NIfTI through the real v1.4 model, cleanup, and metrics', async ({ page }) => {
  test.setTimeout(240_000);
  const result = await verifyMuscleMapFullPipeline(page, 'http://localhost:4318/');

  expect(result.appVersion).toBe(`v${packageJson.version}`);
  expect(result.requestedThreads).toBeGreaterThan(1);
  expect(result.segmentationBytes).toBeGreaterThan(352);
  expect(result.totalVolumeMl).toBeGreaterThan(0);
});
