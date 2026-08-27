import { expect, test } from '@playwright/test';

test('renders model metadata from the generated catalog', async ({ page }) => {
  await page.goto('/index.html');
  const modelOptions = page.locator('#modelSelect option');
  await expect(modelOptions).toHaveCount(6);
  await expect(modelOptions.first()).toHaveText('Whole Body (99 structures, v1.3)');
  await expect(page.locator('#overlapSelect')).toHaveValue('0.5');

  await expect(page.locator('#aboutModelVersion')).toHaveText('v1.3');
  await expect(page.locator('#aboutStructureCount')).toHaveText('99');
  await expect(page.locator('#aboutModelCitation')).toHaveText('10.5281/zenodo.19976940');
});
