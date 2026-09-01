import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQsmxtCommand } from '../src/qsm/index.js';

test('qsm command generator emits changed settings only', () => {
  const command = generateQsmxtCommand({
    dipoleInversion: 'tv',
    tv: { lambda: 0.01 },
    referenceMean: false
  }, ['threshold:otsu'], { doSwi: true });
  assert.match(command, /--qsm-algorithm tv/);
  assert.match(command, /--tv-lambda 0.01/);
  assert.match(command, /--qsm-reference none/);
  assert.match(command, /--do-swi/);
  assert.match(command, /--mask phase-quality,threshold:otsu/);
});
