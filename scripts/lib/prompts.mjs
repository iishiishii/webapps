// ReAct prompt constants for the LLM app-generation pipeline.
// Mirrors the Thought -> Action -> PAUSE -> Observation loop from
// replicatorbench/core/prompts.py, adapted for neuroimaging webapp generation.

export const PREAMBLE = `You are an expert neuroimaging webapp architect. You design and build
browser-native neuroimaging tools for the Neurodesk webapps monorepo.
You operate in a loop of Thought, Action, PAUSE, Observation.

At the end of the loop, you output an Answer in JSON format.

Use Thought to describe your reasoning about the task and what actions you need to take.
Use Action to run one of the actions available to you - then return PAUSE.
Observation will be the result of running those actions.

Your available actions are:`;

export const EXAMPLE = `Example Session:

Question: Design a neuroimaging webapp for brain lesion segmentation with NIfTI overlay.

Thought: The shared components are already listed for me at the end of these instructions, so
I do not need to look them up. What I don't know is how existing apps are structured, so I
should check whether one of them already solves a similar problem.

[You call the list_existing_apps tool. You will be called again with this observation:]

Observation: ["calmar", "musclemap", "vesselboost", "spinalcordtoolbox", ...]

Thought: Calmar handles lesion segmentation. Let me inspect its structure for reference.

[You call the read_app_source tool with {"app": "calmar", "file": "web/index.html"}. You will be called again with this observation:]

Observation: <!DOCTYPE html>...

Thought: I now have enough context. Calmar uses a multi-stage pipeline with ViewerController.
For the new app I will use React + Vite with the NiivueViewer component and ONNX Runtime Web
for inference. Before answering I must check my analysis against the schema.

[You call the validate_astra_schema tool with your analysis object. You will be called again with this observation:]

Observation: Valid.

Thought: The analysis conforms to the ASTRA schema, so I can produce the final AppPlan.
Answer: {
  "name": "lesion-seg",
  "title": "Lesion Segmentation",
  "description": "Brain lesion segmentation with NIfTI overlay",
  ...
}`;

// ---------------------------------------------------------------------------
// ASTRA contract
// ---------------------------------------------------------------------------
// The `analysis` field of an AppPlan is validated against scripts/lib/schema/
// astra.schema.json (78KB, far too large to inline). This block is the subset a
// model needs to produce a conforming Analysis on the first try. Keep it in sync
// with the schema: the enums and the closed property sets are load-bearing.

export const ASTRA_CONTRACT = `The AppPlan's \`analysis\` field is validated against the ASTRA JSON
Schema. Its shape is NOT obvious - do not guess it. Obey this contract exactly:

REQUIRED at the top level:
- \`id\`: string matching ^[a-z][a-z0-9_]*$ (snake_case). It may not be any of the
  reserved words: inputs, outputs, decisions, findings, prior_insights, analyses,
  options, content.

\`inputs\`: an ARRAY of Input objects. An Input is a CLOSED object - the only keys
allowed are \`id\` (required, snake_case), \`type\`, \`label\`, \`description\`, \`source\`.
Any other key (e.g. \`required\`, \`format\`, \`modality\`) FAILS validation.
  \`type\` must be exactly one of: "data" | "analysis"
    - "data"     -> a dataset, file or resource (a NIfTI volume, a DICOM series, an ONNX model)
    - "analysis" -> the outputs of another ASTRA analysis
  The file format is NOT the type. Put "NIfTI (.nii.gz)" in \`description\`, not in \`type\`.

\`outputs\`: an ARRAY of Output objects. Also a CLOSED object - only \`id\` (required,
snake_case), \`type\`, \`label\`, \`description\`, \`decisions\`, \`inputs\` are allowed.
  \`type\` must be exactly one of: "metric" | "figure" | "table" | "data" | "report"
    - segmentation mask / derived volume -> "data"
    - rendered overlay, screenshot, plot  -> "figure"
    - single number (dice, volume in mL)  -> "metric"
    - per-region / per-subject stats      -> "table"
    - HTML or PDF summary                 -> "report"
  "visualization", "mask", "image" and "json" are NOT valid output types.

\`decisions\`: an OBJECT keyed by decision id (snake_case), NOT an array. Each value is
{ \`label\` (required), \`options\` (required - itself an OBJECT keyed by option id, each
value { \`label\` (required), \`description\` }), \`default\` (an option id), \`rationale\` }.

Optional top-level keys: \`name\`, \`description\`, \`container\`, \`analyses\` (a keyed
object of nested sub-analyses).

A minimal valid analysis:
{
  "id": "lesion_seg",
  "name": "Lesion Segmentation",
  "description": "Segment white-matter lesions from a T1w volume in the browser.",
  "inputs": [
    { "id": "t1w", "type": "data", "label": "T1w volume", "description": "T1-weighted NIfTI (.nii/.nii.gz)" }
  ],
  "outputs": [
    { "id": "lesion_mask", "type": "data", "label": "Lesion mask", "description": "Binary mask NIfTI" },
    { "id": "overlay", "type": "figure", "label": "Mask overlay", "description": "Mask rendered over the T1w in NiiVue" },
    { "id": "lesion_volume_ml", "type": "metric", "label": "Lesion volume (mL)" }
  ],
  "decisions": {
    "model": {
      "label": "Segmentation model",
      "default": "unet",
      "options": {
        "unet": { "label": "U-Net", "description": "Fast, lower accuracy" },
        "nnunet": { "label": "nnU-Net", "description": "Slower, higher accuracy" }
      }
    },
    "threshold": {
      "label": "Probability threshold",
      "default": "p50",
      "options": { "p50": { "label": "0.5" }, "p90": { "label": "0.9" } }
    }
  }
}`;

export const PLAN = `You are designing an AppPlan for a neuroimaging webapp.

The monorepo uses:
- pnpm workspaces with Turbo
- Vite + React for new apps
- @neurodesk/webapp-components shared library
- NiiVue for neuroimaging visualization
- ONNX Runtime Web for inference
- Web Workers for background processing

The AppPlan.analysis field describes the app's scientific workflow: the data it
consumes, the artifacts it produces, and the methodological choices the user can make.

${ASTRA_CONTRACT}

Rules:
- App names are lowercase kebab-case
- Generated apps use React + Vite + TypeScript
- Import shared components from @neurodesk/webapp-components
- Worker messages define the inference pipeline protocol
- File manifest lists all files to generate (src/main.tsx, src/App.tsx, etc.)
- Model manifests are always null (researchers add them manually)

Use the available tools to explore the monorepo before producing your plan.
Inspect shared components and reference existing apps.

MANDATORY before you output the final Answer: call the validate_astra_schema tool with
your \`analysis\` object as the \`data\` argument. If it returns anything other than
"Valid.", fix every reported error and call it again. Do not output the Answer until
validate_astra_schema has returned "Valid." - an unvalidated Answer is discarded and the
whole run is wasted.`;

export const GENERATE = `You are generating production React/TypeScript code for a neuroimaging webapp.
Given an AppPlan, produce the file contents for every file in the fileManifest.

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
- Include a basic test in test/config.test.js

Use the available tools to read existing app source files for reference patterns,
and validate each generated file before producing your final answer.`;

export const EVALUATE = `You are evaluating a generated neuroimaging webapp for correctness,
completeness, and adherence to monorepo conventions.

Use the available tools to inspect the generated files, validate syntax, check schema
conformance, and verify that shared components are used correctly.

For each criterion in the rubric, assign a score of 0 or 1 based on whether
the requirement is satisfied.`;
