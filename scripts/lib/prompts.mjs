// Prompt constants for the LLM app-generation pipeline.
// The agentic loop in agent.mjs handles tool-calling mechanics via the
// OpenAI-compatible API (tool_choice: "auto"). These prompts focus on
// domain expertise, not agent protocol.

export const PREAMBLE = `You are an expert neuroimaging webapp architect. You design and build
browser-native neuroimaging tools for the Neurodesk webapps monorepo.

Use the available tools only when the request needs repository context.
When you have gathered enough information, output your final Answer as a JSON object.
`;

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
- Vite with the canonical JavaScript imaging-workspace template
- @neurodesk/webapp-components shared library
- NiiVue for neuroimaging visualization
- ONNX Runtime Web for inference
- Web Workers for background processing

The AppPlan.analysis field describes the app's scientific workflow: the data it
consumes, the artifacts it produces, and the methodological choices the user can make.

Return exactly this AppPlan envelope. Every field shown is required:
{
  "name": "lowercase-kebab-case",
  "title": "Human-readable title",
  "description": "One-line registry description",
  "imagingModality": "nifti",
  "viewerType": "overlay",
  "sharedComponents": ["named component exports"],
  "workerMessages": [{ "type": "message-name", "payload": "JavaScript payload shape" }],
  "fileManifest": ["package.json", "index.html", "src/main.js", "src/config.js", "src/worker.js", "vite.config.js", "eslint.config.js", "playwright.config.js", "public/_headers", "test/config.test.js", "e2e/smoke.spec.js"],
  "registryFields": {
    "runtime": "react-vite",
    "modelManifest": null,
    "supportStatus": "experimental",
    "shell": "imaging-workspace",
    "toolchains": ["node"]
  },
  "analysis": {}
}
Choose imagingModality from "nifti", "dicom", or "generic"; viewerType from
"2d-slice", "3d-volume", "overlay", or "comparison"; supportStatus from
"experimental" or "active"; and shell from "static-html" or "imaging-workspace".

${ASTRA_CONTRACT}

Rules:
- App names are lowercase kebab-case
- Generated apps use the canonical JavaScript + Vite imaging-workspace template
- Import shared components from @neurodesk/webapp-components
- Worker messages define the inference pipeline protocol
- File manifest includes every canonical template file plus scientific workers/modules required by the workflow
- Model manifests are always null (researchers add them manually)

The shared-component catalog is already in the prompt. Use read_app_template once to
inspect the canonical templates/app-template scaffold. Do not inspect existing apps.
After reading the template, produce the complete plan immediately. The complete AppPlan
and its analysis are validated automatically after your Answer.`;

export const GENERATE = `You are generating one production JavaScript/Vite file for a neuroimaging webapp.
Given an AppPlan, shared blueprint, target filename, and optional canonical template content,
produce exactly that file.

Rules:
- Import shared components from @neurodesk/webapp-components
- Follow the canonical imaging-workspace template and use src/main.js and src/config.js
- Vite as the build tool
- The target file must be nonempty and syntactically valid
- Return exactly a JSON object with filename and content
- Do not inspect existing apps or return any other file.`;

export const EVALUATE = `You are evaluating a generated neuroimaging webapp for correctness,
completeness, and adherence to monorepo conventions.

Use the available tools to inspect the generated files, validate syntax, check schema
conformance, and verify that shared components are used correctly.

For each criterion in the rubric, assign a score of 0 or 1 based on whether
the requirement is satisfied.`;
