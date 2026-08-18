#!/usr/bin/env node
// scripts/generate-app.mjs
// LLM pipeline: natural-language description -> working neuroimaging webapp.
//
// Two-step pipeline:
//   Step 1 (reasoning, T=0.8): user description -> AppPlan (ASTRA Analysis + scaffolding)
//   Step 2 (generation, T=0.2): AppPlan -> file contents
//
// Validates against ASTRA JSON Schema (scientific workflow) and local JSON Schemas
// (scaffolding). Generated files validated with @babel/parser (JS/TS syntax).
//
// Usage:
//   ANTHROPIC_API_KEY=... node scripts/generate-app.mjs "brain lesion viewer with NIfTI overlay"
//   node scripts/generate-app.mjs --dry-run "brain lesion viewer with NIfTI overlay"
//   node scripts/generate-app.mjs --force "brain lesion viewer with NIfTI overlay"

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callLLM } from "./lib/call-llm.mjs";
import { retryWithDecay } from "./lib/retry.mjs";
import {
  extractCatalog,
  formatCatalog,
  estimateTokens,
} from "./lib/catalog.mjs";
import { validateAnalysis, validateFile } from "./lib/validate.mjs";
import { writeApp, buildRegistryEntry } from "./lib/file-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// --- CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const description = args.filter((a) => !a.startsWith("--")).join(" ");

if (!description) {
  console.error(
    "Usage: node scripts/generate-app.mjs [--dry-run] [--force] <description>"
  );
  console.error(
    '  e.g. node scripts/generate-app.mjs "brain lesion viewer with NIfTI overlay"'
  );
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY environment variable is required.");
  process.exit(1);
}

// --- Load schemas ---
const appPlanSchema = JSON.parse(
  await readFile(join(__dirname, "lib/schema/app-plan.schema.json"), "utf8")
);
const generatedAppSchema = JSON.parse(
  await readFile(
    join(__dirname, "lib/schema/generated-app.schema.json"),
    "utf8"
  )
);

// --- Build component catalog ---
const catalog = await extractCatalog(root);
let catalogText = formatCatalog(catalog, false);
if (estimateTokens(catalogText) > 3000) {
  catalogText = formatCatalog(catalog, true); // compact: name + module only
}

// --- System prompts ---
const STEP1_SYSTEM = `You are an expert neuroimaging webapp architect. You design browser-native
neuroimaging tools for the Neurodesk webapps monorepo.

The monorepo uses:
- pnpm workspaces with Turbo
- Vite + React for new apps
- @neurodesk/webapp-components shared library
- NiiVue for neuroimaging visualization
- ONNX Runtime Web for inference
- Web Workers for background processing

Available shared components:
${catalogText}

Your task: given a natural-language description of a neuroimaging tool, produce
a structured AppPlan that describes the app's scientific workflow (using ASTRA
spec format for inputs/outputs/decisions) and its scaffolding (files, registry,
viewer type).

The AppPlan.analysis field must follow the ASTRA spec:
- inputs: what data the app consumes (NIfTI, DICOM, etc.)
- outputs: what the app produces (segmentation masks, metrics, visualizations)
- decisions: methodological choices the user can make (model, preprocessing, threshold)

Rules:
- App names are lowercase kebab-case
- Generated apps use React + Vite + TypeScript
- Import shared components from @neurodesk/webapp-components
- Worker messages define the inference pipeline protocol
- File manifest lists all files to generate (src/main.tsx, src/App.tsx, etc.)
- Model manifests are always null (researchers add them manually)`;

const STEP2_SYSTEM = `You are an expert React/TypeScript developer generating production code for a
neuroimaging webapp. Given an AppPlan, produce the file contents for every file
in the fileManifest.

Rules:
- Use React functional components with hooks
- Import NiiVue from @niivue/niivue
- Import shared components from @neurodesk/webapp-components
- Use the NiivueViewer component from @neurodesk/webapp-components/viewer/react for the viewer
- TypeScript with strict types
- Vite as the build tool
- Each file must be syntactically valid
- package.json must include all required dependencies
- index.html must mount the React app
- Include a basic test in test/config.test.js`;

// --- Step 1: Reasoning ---
console.log("Step 1: Generating app plan...");

const appPlan = await retryWithDecay(
  async ({ temperature }) => {
    const result = await callLLM({
      systemPrompt: STEP1_SYSTEM,
      userMessage: `Design a neuroimaging webapp for this description:\n\n${description}`,
      schema: appPlanSchema,
      toolName: "create_app_plan",
      temperature,
      maxTokens: 2000,
    });

    // Validate the ASTRA analysis part
    if (result.analysis) {
      const { valid, errors } = await validateAnalysis(result.analysis);
      if (!valid) {
        throw new Error(
          `ASTRA Analysis validation failed: ${JSON.stringify(errors, null, 2)}`
        );
      }
    }

    return result;
  },
  [0.8, 0.6, 0.4],
  "step1-reasoning"
);

console.log(`App plan: ${appPlan.name} - ${appPlan.title}`);
console.log(`  Modality: ${appPlan.imagingModality}`);
console.log(`  Viewer: ${appPlan.viewerType}`);
console.log(`  Files: ${appPlan.fileManifest.length}`);
if (appPlan.analysis?.inputs) {
  console.log(`  ASTRA inputs: ${appPlan.analysis.inputs.length}`);
}
if (appPlan.analysis?.decisions) {
  console.log(
    `  ASTRA decisions: ${Object.keys(appPlan.analysis.decisions).length}`
  );
}

// --- Step 2: Code Generation ---
console.log("\nStep 2: Generating code...");

const generatedApp = await retryWithDecay(
  async ({ temperature }) => {
    const result = await callLLM({
      systemPrompt: STEP2_SYSTEM,
      userMessage: `Generate all files for this app plan:\n\n${JSON.stringify(appPlan, null, 2)}`,
      schema: generatedAppSchema,
      toolName: "generate_app_files",
      temperature,
      maxTokens: 8000,
    });

    // Validate each generated file
    const errors = [];
    for (const [filename, content] of Object.entries(result.files)) {
      const { valid, error } = await validateFile(filename, content);
      if (!valid) errors.push(error);
    }
    if (errors.length > 0) {
      throw new Error(`File validation failed:\n${errors.join("\n")}`);
    }

    return result;
  },
  [0.2, 0.1, 0.0],
  "step2-generation"
);

console.log(`Generated ${Object.keys(generatedApp.files).length} files`);

// --- Write astra.yaml alongside app files ---
if (appPlan.analysis) {
  const { stringify } = await import("yaml");
  generatedApp.files["astra.yaml"] = stringify(appPlan.analysis);
  console.log("  + astra.yaml (scientific workflow spec)");
}

// --- Write files ---
const registryEntry = buildRegistryEntry({
  name: appPlan.name,
  title: appPlan.title,
  description: appPlan.description,
  runtime: appPlan.registryFields.runtime,
  modelManifest: appPlan.registryFields.modelManifest,
  supportStatus: appPlan.registryFields.supportStatus,
  shell: appPlan.registryFields.shell,
});

await writeApp(appPlan.name, generatedApp.files, registryEntry, {
  root,
  dryRun,
  force,
});

if (!dryRun) {
  console.log(`\nNext steps:`);
  console.log(`  pnpm install`);
  console.log(`  pnpm --filter ${appPlan.name} dev`);
  console.log(
    `  pnpm --filter ${appPlan.name} build && pnpm --filter ${appPlan.name} test`
  );
}
