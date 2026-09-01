#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const mirrors = [
  ['packages/components/src/ui/DicompareReportRenderer.js', 'apps/dicompare/public/embed/DicompareReportRenderer.js'],
];

for (const [source, target] of mirrors) {
  const output = join(repoRoot, target);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(join(repoRoot, source), output);
}
