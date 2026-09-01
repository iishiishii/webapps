import { expect, test } from '@playwright/test';

test('serves the complete v1.4 FP32 model from verified same-origin parts', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const chunks = [];
    let total = 0;
    for (let index = 0; index < 5; index++) {
      const response = await fetch(`/models/musclemap-wholebody-v1.4-fp32.part-0${index}`);
      if (!response.ok) throw new Error(`Model part ${index} returned ${response.status}`);
      const chunk = new Uint8Array(await response.arrayBuffer());
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    const model = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      model.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', model));
    return {
      partBytes: chunks.map(chunk => chunk.byteLength),
      total,
      sha256: [...digest].map(value => value.toString(16).padStart(2, '0')).join('')
    };
  });

  expect(result.partBytes).toEqual([21000000, 21000000, 21000000, 21000000, 20946960]);
  expect(result.total).toBe(104946960);
  expect(result.sha256).toBe('6380bd2487eeb47bdc59d63eef69fb0241bd11976712677ccee329f83552a1e6');
});
