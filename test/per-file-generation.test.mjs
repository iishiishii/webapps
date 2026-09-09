import assert from "node:assert/strict";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateAppFiles, TEMPLATE_FILES } from "../scripts/lib/per-file-generation.mjs";
import { validateFile } from "../scripts/lib/validate.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const plan = { name: "mock-qsm", title: "Mock QSM", description: "QSM", imagingModality: "nifti", viewerType: "overlay", sharedComponents: [], workerMessages: [], fileManifest: [...TEMPLATE_FILES, "src/qsm.js", "src/qsm-worker.js", "test/qsm.test.js"], registryFields: { runtime: "react-vite", modelManifest: null, supportStatus: "experimental", shell: "imaging-workspace", toolchains: ["node"] }, analysis: { id: "mock_qsm", inputs: [], outputs: [], decisions: {} } };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "per-file-generation-"));
  await cp(join(repoRoot, "templates", "app-template"), join(root, "templates", "app-template"), { recursive: true });
  return root;
}

function blueprint() {
  return { files: plan.fileManifest.map((filename) => ({ filename, action: filename === "src/main.js" ? "modify" : TEMPLATE_FILES.includes(filename) ? "keep" : "create", imports: [], exports: [], responsibility: `Own ${filename}` })) };
}

test("seeds keep files, retries a malformed file, and reuses checkpoints", async () => {
  const root = await fixture(); let calls = 0; let mainAttempts = 0;
  const invoke = async ({ toolName, userMessage }) => {
    calls++;
    if (toolName === "create_file_blueprint") return { value: blueprint(), usage: { prompt_tokens: 2, completion_tokens: 3 } };
    const filename = userMessage.match(/Target filename \(copy exactly; never add an extension\):\n([^\n]+)/)[1];
    if (filename === "src/main.js" && mainAttempts++ === 0) return { value: { filename: "wrong.js", content: "x" }, usage: {} };
    return { value: { filename, content: filename.endsWith(".js") ? `export const generated = ${JSON.stringify(filename)};\n` : "generated\n" }, usage: { prompt_tokens: 1, completion_tokens: 1 } };
  };
  const first = await generateAppFiles({ appPlan: plan, root, invoke });
  assert.deepEqual(Object.keys(first.files).sort(), [...plan.fileManifest].sort());
  assert.match(first.files["src/config.js"], /mock-qsm/);
  assert.equal(first.metrics.generated_files, 4);
  assert.equal(first.metrics.attempts, 5);
  const callsAfterFirst = calls;
  const second = await generateAppFiles({ appPlan: plan, root, invoke });
  assert.equal(calls, callsAfterFirst);
  assert.equal(second.metrics.reused_files, 4);
});

test("reports the failed filename and preserves completed checkpoints", async () => {
  const root = await fixture();
  const invoke = async ({ toolName, userMessage }) => toolName === "create_file_blueprint"
    ? { value: blueprint(), usage: {} }
    : { value: { filename: userMessage.match(/Target filename \(copy exactly; never add an extension\):\n([^\n]+)/)[1], content: "export {" }, usage: {} };
  await assert.rejects(generateAppFiles({ appPlan: plan, root, invoke }), (error) => {
    assert.equal(error.metrics.failed_filename, "src/main.js");
    assert.equal(error.metrics.attempts, 3);
    return true;
  });
});

test("invalidates checkpoints when the model changes", async () => {
  const root = await fixture(); let blueprintCalls = 0;
  const invoke = async ({ toolName, userMessage }) => {
    if (toolName === "create_file_blueprint") { blueprintCalls++; return { value: blueprint(), usage: {} }; }
    const filename = userMessage.match(/Target filename \(copy exactly; never add an extension\):\n([^\n]+)/)[1];
    return { value: { filename, content: `export const value = ${JSON.stringify(filename)};\n` }, usage: {} };
  };
  await generateAppFiles({ appPlan: plan, root, model: "model-a", invoke });
  await generateAppFiles({ appPlan: plan, root, model: "model-b", invoke });
  assert.equal(blueprintCalls, 2);
});

test("retries blueprint creation and checkpoints an exhausted failure", async () => {
  const root = await fixture(); let calls = 0;
  const invoke = async () => { calls++; return { value: { files: [], explanation: "not allowed" }, usage: {} }; };
  let caught;
  try { await generateAppFiles({ appPlan: plan, root, invoke }); } catch (error) { caught = error; }
  assert.ok(caught);
  assert.equal(calls, 3);
  assert.equal(caught.metrics.failed_filename, "blueprint");
  assert.equal(caught.metrics.blueprint_attempts, 3);
  const failure = JSON.parse(await readFile(join(caught.metrics.cache_location, "failure.json"), "utf8"));
  assert.equal(failure.stage, "blueprint");
  assert.equal(failure.attempts, 3);
});

test("HTML validation handles void elements and rejects misnested tags", async () => {
  assert.equal((await validateFile("index.html", "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><input><br></body></html>")).valid, true);
  const malformed = await validateFile("index.html", "<!doctype html><html><head></head><body><main><div></main></div></body></html>");
  assert.equal(malformed.valid, false);
  assert.match(malformed.error, /misnested/);
});
