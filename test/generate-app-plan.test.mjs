import assert from "node:assert/strict";
import test from "node:test";

import { validateAppPlan } from "../scripts/lib/validate.mjs";

const validPlan = {
  name: "lesion-seg",
  title: "Lesion Segmentation",
  description: "Segments lesions in a NIfTI volume.",
  imagingModality: "nifti",
  viewerType: "overlay",
  sharedComponents: ["NiivueViewer"],
  workerMessages: [{ type: "segment", payload: "{ volume: ArrayBuffer }" }],
  fileManifest: ["package.json", "index.html", "src/main.tsx", "src/App.tsx"],
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
