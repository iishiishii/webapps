import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildKnownActions,
  buildToolDefinitions,
} from "../scripts/lib/agent.mjs";
import { validateAppPlan } from "../scripts/lib/validate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

const validPlan = {
  name: "lesion-seg",
  title: "Lesion Segmentation",
  description: "Segments lesions in a NIfTI volume.",
  imagingModality: "nifti",
  viewerType: "overlay",
  sharedComponents: ["NiivueViewer"],
  workerMessages: [{ type: "segment", payload: "{ volume: ArrayBuffer }" }],
  fileManifest: ["package.json", "index.html", "src/main.js", "src/config.js", "src/worker.js", "vite.config.js", "eslint.config.js", "playwright.config.js", "public/_headers", "test/config.test.js", "e2e/smoke.spec.js"],
  registryFields: {
    runtime: "react-vite",
    modelManifest: null,
    supportStatus: "experimental",
    shell: "imaging-workspace",
    toolchains: ["node"],
  },
  analysis: {
    id: "lesion_seg",
    inputs: [{ id: "volume", type: "data" }],
    outputs: [{ id: "mask", type: "data" }],
    decisions: {},
  },
};

test("validateAppPlan accepts a complete plan", async () => {
  assert.deepEqual(await validateAppPlan(validPlan), { valid: true, errors: null });
});

test("validateAppPlan rejects missing scaffolding fields", async () => {
  const { imagingModality, viewerType, registryFields, ...incomplete } = validPlan;
  const result = await validateAppPlan(incomplete);
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.errors.filter((error) => error.keyword === "required").map(
      (error) => error.params.missingProperty,
    ),
    ["imagingModality", "viewerType", "registryFields"],
  );
});

test("validateAppPlan rejects unsafe paths and missing canonical files", async () => {
  const result = await validateAppPlan({ ...validPlan, fileManifest: ["package.json", "../escape.js"] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "safeRelativePath"));
  assert.ok(result.errors.some((error) => error.keyword === "canonicalTemplate"));
});

test("validateAppPlan requires a worker module for a declared worker protocol", async () => {
  const result = await validateAppPlan({ ...validPlan, fileManifest: validPlan.fileManifest.filter((path) => path !== "src/worker.js") });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "scientificModule"));
});

test("validateAppPlan rejects duplicated file extensions", async () => {
  const result = await validateAppPlan({ ...validPlan, fileManifest: [...validPlan.fileManifest, "package.json.json"] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "duplicateExtension"));
});

test("validateAppPlan reports ASTRA errors under analysis", async () => {
  const result = await validateAppPlan({
    ...validPlan,
    analysis: { ...validPlan.analysis, id: "invalid-id" },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath === "/analysis/id"));
});

test("validateAppPlan reports envelope and ASTRA errors together", async () => {
  const { viewerType, ...incomplete } = validPlan;
  const result = await validateAppPlan({
    ...incomplete,
    analysis: { ...validPlan.analysis, id: "invalid-id" },
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (error) => error.params?.missingProperty === "viewerType",
    ),
  );
  assert.ok(result.errors.some((error) => error.instancePath === "/analysis/id"));
});

test("Step 1 can inspect the complete canonical app template in one call", async () => {
  const tools = buildToolDefinitions(["read_app_template"]);
  assert.deepEqual(
    tools.map(({ function: definition }) => definition.name),
    ["read_app_template"],
  );

  const template = await buildKnownActions({ root }).read_app_template({});
  assert.match(template, /--- package\.json ---/);
  assert.match(template, /--- src\/main\.js ---/);
  assert.match(template, /--- e2e\/smoke\.spec\.js ---/);
  assert.doesNotMatch(template, /Error:/);
});
