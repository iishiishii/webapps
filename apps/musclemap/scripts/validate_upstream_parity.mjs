#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { MODEL_RELEASES } from '../web/js/app/model-catalog.generated.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, '..');
const defaultStage = resolve(appDir, '.tmp_model_release', 'wholebody-v1.4');
const defaultReferenceManifest = resolve(appDir, 'model-sources', 'upstream-reference-cases.json');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function hasArgument(name) {
  return process.argv.includes(name);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function waitForServer(url, processHandle) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (processHandle.exitCode !== null) throw new Error('Parity validation server exited early');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Parity validation server did not start: ${url}`);
}

async function startBinaryServer(port, files) {
  const metadata = new Map();
  for (const [urlPath, filePath] of Object.entries(files)) {
    const fileStats = await stat(filePath);
    metadata.set(urlPath, { filePath, bytes: fileStats.size });
  }
  const server = createServer((request, response) => {
    const entry = metadata.get(request.url);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('Cache-Control', 'no-store');
    if (!entry) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', entry.bytes);
    createReadStream(entry.filePath).pipe(response);
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  return server;
}

async function main() {
  const caseId = argument('--case', null);
  let controlledCase = null;
  if (caseId) {
    const manifestPath = resolve(argument('--reference-manifest', defaultReferenceManifest));
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    controlledCase = manifest.cases?.find(item => item.id === caseId);
    if (!controlledCase) throw new Error(`Unknown controlled reference case: ${caseId}`);
  }
  const referenceRoot = argument('--reference-root', null);
  const inputValue = argument('--input', controlledCase && referenceRoot
    ? resolve(referenceRoot, controlledCase.input)
    : null);
  const referenceValue = argument('--reference', controlledCase && referenceRoot
    ? resolve(referenceRoot, controlledCase.reference)
    : null);
  if (!inputValue || !referenceValue) {
    throw new Error('Provide --input and --reference, or provide --case with --reference-root');
  }
  const inputPath = resolve(inputValue);
  const referencePath = resolve(referenceValue);
  const precision = argument('--precision', 'fp32');
  const overlap = Number(argument('--overlap', String(controlledCase?.overlap ?? 0.5)));
  const sourceChunkSizeRaw = argument('--source-chunk-size', String(controlledCase?.sourceChunkSize ?? 17));
  const sourceChunkSize = sourceChunkSizeRaw === 'full' ? 'full' : Number(sourceChunkSizeRaw);
  const outputPath = resolve(argument('--output', resolve(defaultStage, 'upstream-parity-output.nii')));
  const reportPath = resolve(argument('--report', resolve(defaultStage, 'upstream-parity-report.json')));
  const conversionPath = resolve(argument('--conversion-report', resolve(defaultStage, 'conversion-report.json')));
  const conversion = JSON.parse(await readFile(conversionPath, 'utf8'));
  const candidate = conversion.candidates.find(item => item.precision === precision);
  if (!candidate) throw new Error(`Conversion report has no ${precision} candidate`);
  const candidatePath = resolve(dirname(conversionPath), candidate.path);
  const candidateBytes = await readFile(candidatePath);
  if (candidateBytes.byteLength !== candidate.bytes || sha256(candidateBytes) !== candidate.sha256) {
    throw new Error('Candidate does not match the conversion report');
  }
  await stat(inputPath);
  await stat(referencePath);
  if (controlledCase) {
    const inputDigest = sha256(await readFile(inputPath));
    const referenceDigest = sha256(await readFile(referencePath));
    if (inputDigest !== controlledCase.inputSha256 || referenceDigest !== controlledCase.referenceSha256) {
      throw new Error(`Controlled reference case ${caseId} failed SHA-256 verification`);
    }
    if (hasArgument('--overlap') || hasArgument('--source-chunk-size')) {
      throw new Error('Controlled reference cases use their pinned overlap and source chunk size');
    }
  }
  await mkdir(dirname(outputPath), { recursive: true });

  const stagedModel = MODEL_RELEASES.find(model =>
    model.id === 'wholebody' && model.modelVersion === '1.4'
  );
  if (!stagedModel) throw new Error('Generated catalog has no staged whole-body v1.4 descriptor');

  const port = Number(argument('--port', '4322'));
  const baseUrl = `http://127.0.0.1:${port}`;
  const binaryPort = port + 1;
  const modelUrl = `http://127.0.0.1:${binaryPort}/model.onnx`;
  const inputUrl = `http://127.0.0.1:${binaryPort}/input.nii.gz`;
  const server = spawn('bash', ['web/run.sh', String(port)], {
    cwd: appDir,
    stdio: 'ignore'
  });
  const binaryServer = await startBinaryServer(binaryPort, {
    '/model.onnx': candidatePath,
    '/input.nii.gz': inputPath
  });
  let browser;
  try {
    await waitForServer(`${baseUrl}/harness.html`, server);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(0);
    page.on('crash', () => process.stderr.write('ERROR: parity browser page crashed\n'));
    await page.exposeFunction('__reportParityEvent', event => {
      if (event.type === 'log') process.stdout.write(`${event.message}\n`);
      if (event.type === 'progress') {
        process.stdout.write(`[${Math.round(event.value * 100)}%] ${event.text}\n`);
      }
    });
    await page.goto(`${baseUrl}/harness.html`);

    const outputDownload = page.waitForEvent('download');
    const modelDescriptor = {
      ...stagedModel,
      asset: {
        url: modelUrl,
        revision: 'local-upstream-parity',
        bytes: candidate.bytes,
        sha256: candidate.sha256,
        precision,
        validationReport: 'local-upstream-parity'
      }
    };
    const completion = page.evaluate(async ({ routedInputUrl, model, selectedOverlap, selectedSourceChunkSize }) => {
      const inputData = await (await fetch(routedInputUrl)).arrayBuffer();
      const worker = new Worker('/js/inference-worker.js', { type: 'module' });
      await new Promise((resolvePromise, reject) => {
        let initialized = false;
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessage = event => {
          const data = event.data;
          if (data.type === 'log' || data.type === 'progress') window.__reportParityEvent(data);
          if (data.type === 'error') reject(new Error(data.message));
          if (data.type === 'initialized' && !initialized) {
            initialized = true;
            worker.postMessage({
              type: 'run',
              data: {
                inputData,
                settings: {
                  model,
                  overlap: selectedOverlap,
                  chunkSize: 'auto',
                  sourceChunkSize: selectedSourceChunkSize,
                  useWebGPU: false,
                  sliceThickness: -1,
                  lowRes: false,
                  calculateMetrics: false
                }
              }
            }, [inputData]);
          }
          if (data.type === 'stageData' && data.stage === 'segmentation') {
            const link = document.createElement('a');
            link.download = 'upstream-parity-output.nii';
            link.href = URL.createObjectURL(new Blob([data.niftiData], { type: 'application/octet-stream' }));
            link.click();
          }
          if (data.type === 'complete') {
            worker.terminate();
            resolvePromise();
          }
        };
        worker.postMessage({ type: 'init', version: 'upstream-parity' });
      });
    }, {
      routedInputUrl: inputUrl,
      model: modelDescriptor,
      selectedOverlap: overlap,
      selectedSourceChunkSize: sourceChunkSize
    });
    const download = await Promise.race([
      outputDownload,
      completion.then(() => {
        throw new Error('Worker completed without producing a segmentation download');
      })
    ]);
    await download.saveAs(outputPath);
    await completion;

    const python = spawn(resolve(appDir, '.tmp_model_env', 'bin', 'python'), [
      resolve(scriptDir, 'compare_upstream_output.py'),
      '--reference', referencePath,
      '--candidate', outputPath,
      '--report', reportPath
    ], { cwd: appDir, stdio: 'inherit' });
    const exitCode = await new Promise(resolvePromise => python.on('exit', resolvePromise));
    if (exitCode !== 0) throw new Error(`Upstream comparison failed; see ${reportPath}`);
    const comparison = JSON.parse(await readFile(reportPath, 'utf8'));
    const inputBytes = await readFile(inputPath);
    const referenceBytes = await readFile(referencePath);
    comparison.candidate = {
      precision: candidate.precision,
      path: candidate.path,
      bytes: candidate.bytes,
      sha256: candidate.sha256
    };
    comparison.run = {
      input: { path: inputPath, bytes: inputBytes.byteLength, sha256: sha256(inputBytes) },
      reference: { path: referencePath, bytes: referenceBytes.byteLength, sha256: sha256(referenceBytes) },
      overlap,
      sourceChunkSize,
      backend: 'wasm'
    };
    if (controlledCase) comparison.run.controlledReferenceCase = controlledCase.id;
    await writeFile(reportPath, `${JSON.stringify(comparison, null, 2)}\n`);
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    binaryServer.close();
  }
}

main().catch(error => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
