#!/usr/bin/env node
// scripts/generate-app.mjs
// LLM pipeline: natural-language description -> working neuroimaging webapp.
//
// Two-step pipeline:
//   Step 1 (planning, T=0.4): user description -> AppPlan (ASTRA Analysis + scaffolding)
//   Step 2 (generation, T=0.2): AppPlan -> file contents
//
// Two execution modes:
//   Agentic (default): multi-turn tool-calling loop via any
//     OpenAI-compatible endpoint (vLLM, Ollama, together.ai, OpenAI, etc.)
//   Single-shot (--no-react): forced tool_use via Anthropic/OpenAI SDK
//
// Validates against ASTRA JSON Schema (scientific workflow) and local JSON Schemas
// (scaffolding). Generated files validated with @babel/parser (JS/TS syntax).
//
// Usage:
//   LLM_API_KEY=... node scripts/generate-app.mjs "brain lesion viewer with NIfTI overlay"
//   LLM_BASE_URL=http://localhost:8000/v1 LLM_MODEL=meta-llama/... node scripts/generate-app.mjs "..."
//   node scripts/generate-app.mjs --no-react "brain lesion viewer"   # single-shot SDK mode
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
import { validateAppPlan, validateFile } from "./lib/validate.mjs";
import { writeApp, buildRegistryEntry } from "./lib/file-writer.mjs";
import {
  runReactLoop,
  buildKnownActions,
  buildToolDefinitions,
} from "./lib/agent.mjs";
import {
  PREAMBLE,
  PLAN,
  GENERATE,
  ASTRA_CONTRACT,
} from "./lib/prompts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// --- CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const useReact = !args.includes("--no-react"); // agentic loop by default, --no-react for single-shot
const description = args.filter((a) => !a.startsWith("--")).join(" ");

if (!description) {
  console.error(
    "Usage: node scripts/generate-app.mjs [--dry-run] [--force] [--no-react] <description>",
  );
  console.error(
    '  e.g. node scripts/generate-app.mjs "brain lesion viewer with NIfTI overlay"',
  );
  process.exit(1);
}

// ReAct mode needs LLM_API_KEY or OPENAI_API_KEY; single-shot needs ANTHROPIC_API_KEY
if (!useReact && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY environment variable is required for single-shot mode.",
  );
  process.exit(1);
}
if (useReact && !process.env.LLM_API_KEY && !process.env.OPENAI_API_KEY) {
  console.error(
    "LLM_API_KEY or OPENAI_API_KEY environment variable is required for ReAct mode.",
  );
  process.exit(1);
}

// --- Load schemas (only needed for single-shot mode) ---
let appPlanSchema, generatedAppSchema;
if (!useReact) {
  appPlanSchema = JSON.parse(
    await readFile(join(__dirname, "lib/schema/app-plan.schema.json"), "utf8"),
  );
  generatedAppSchema = JSON.parse(
    await readFile(
      join(__dirname, "lib/schema/generated-app.schema.json"),
      "utf8",
    ),
  );
}

// --- Build component catalog ---
const catalog = await extractCatalog(root);
let catalogText = formatCatalog(catalog, false);
if (estimateTokens(catalogText) > 3000) {
  catalogText = formatCatalog(catalog, true); // compact: name + module only
}

// --- System prompts (single-shot fallback) ---
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

The AppPlan.analysis field describes the app's scientific workflow: the data it
consumes, the artifacts it produces, and the methodological choices the user can make.

${ASTRA_CONTRACT}

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

let appPlan;
let generatedApp;

if (useReact) {
  // -----------------------------------------------------------------------
  // Agentic mode: multi-turn tool-calling loop
  // -----------------------------------------------------------------------
  const knownActions = buildKnownActions({ root });
  const step1Tools = buildToolDefinitions([
    "list_existing_apps",
    "list_app_files",
    "read_app_source",
  ]);
  const step2Tools = buildToolDefinitions([
    "list_existing_apps",
    "list_app_files",
    "read_app_source",
    "validate_syntax",
  ]);

  // Step 1: Plan via agentic loop
  const step1System = [
    PREAMBLE,
    PLAN,
    `\nAvailable shared components:\n${catalogText}`,
  ].join("\n");

  // Validate both the scaffolding envelope and ASTRA analysis. Returning
  // feedback keeps a repair inside the bounded planning loop.
  const validateFinalAppPlan = async (answer) => {
    const { valid, errors } = await validateAppPlan(answer);
    if (valid) return { ok: true };
    return {
      ok: false,
      feedback: `Your Answer failed AppPlan validation:

${JSON.stringify(errors, null, 2)}

Fix every error and output the complete corrected AppPlan.`,
    };
  };

  console.log("Step 1 (ReAct): Generating app plan...");
  const step1Result = await runReactLoop({
    systemPrompt: step1System,
    question: `Design a neuroimaging webapp for this description:\n\n${description}\n\nProduce the final Answer as a complete JSON AppPlan.`,
    knownActions,
    tools: step1Tools,
    temperature: 0.4,
    maxTurns: 5,
    maxTokens: 3000,
    maxObservationChars: 3000,
    validateAnswer: validateFinalAppPlan,
  });
  appPlan = step1Result.answer;
  console.log(
    `Step 1 metrics: ${step1Result.metrics.total_turns} turns, ${step1Result.metrics.total_tokens} tokens` +
      (step1Result.metrics.rejected_answers
        ? `, ${step1Result.metrics.rejected_answers} answer(s) repaired`
        : ""),
  );

  if (step1Result.metrics.status !== "success") {
    console.error(`Step 1 failed: ${appPlan.error}`);
    process.exit(1);
  }

  // Step 2: Generate code via agentic loop
  const step2System = [
    PREAMBLE,
    GENERATE,
    `\nAvailable shared components:\n${catalogText}`,
  ].join("\n");

  console.log("\nStep 2 (agentic): Generating code...");
  const step2Result = await runReactLoop({
    systemPrompt: step2System,
    question: `Generate all files for this app plan:\n\n${JSON.stringify(appPlan, null, 2)}\n\nRead existing apps for reference patterns. Validate each file. Produce the final Answer as a JSON object with a "files" key mapping filenames to contents.`,
    knownActions,
    tools: step2Tools,
    temperature: 0.2,
    maxTurns: 20,
  });
  generatedApp = step2Result.answer;
  console.log(
    `Step 2 metrics: ${step2Result.metrics.total_turns} turns, ${step2Result.metrics.total_tokens} tokens`,
  );
} else {
  // -----------------------------------------------------------------------
  // Single-shot mode (original pipeline, --no-react)
  // -----------------------------------------------------------------------
  console.log("Step 1: Generating app plan...");

  appPlan = await retryWithDecay(
    async ({ temperature }) => {
      const result = await callLLM({
        systemPrompt: STEP1_SYSTEM,
        userMessage: `Design a neuroimaging webapp for this description:\n\n${description}`,
        schema: appPlanSchema,
        toolName: "create_app_plan",
        temperature,
        maxTokens: 2000,
      });

      const { valid, errors } = await validateAppPlan(result);
      if (!valid) {
        throw new Error(
          `AppPlan validation failed: ${JSON.stringify(errors, null, 2)}`,
        );
      }

      return result;
    },
    [0.8, 0.6, 0.4],
    "step1-reasoning",
  );

  console.log("\nStep 2: Generating code...");

  generatedApp = await retryWithDecay(
    async ({ temperature }) => {
      const result = await callLLM({
        systemPrompt: STEP2_SYSTEM,
        userMessage: `Generate all files for this app plan:\n\n${JSON.stringify(appPlan, null, 2)}`,
        schema: generatedAppSchema,
        toolName: "generate_app_files",
        temperature,
        maxTokens: 8000,
      });

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
    "step2-generation",
  );
}

console.log(`App plan: ${appPlan.name} - ${appPlan.title}`);
console.log(`  Modality: ${appPlan.imagingModality}`);
console.log(`  Viewer: ${appPlan.viewerType}`);
console.log(
  `  Files: ${appPlan.fileManifest?.length || Object.keys(generatedApp.files || {}).length}`,
);

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
    `  pnpm --filter ${appPlan.name} build && pnpm --filter ${appPlan.name} test`,
  );
}
