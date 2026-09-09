import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { callChat, callLLM } from "./call-llm.mjs";
import { validateFile } from "./validate.mjs";

export const BLUEPRINT_PROMPT_VERSION = "per-file-generation-v3";
export const TEMPLATE_FILES = [
  "package.json", "index.html", "src/main.js", "src/config.js",
  "vite.config.js", "eslint.config.js", "playwright.config.js",
  "public/_headers", "test/config.test.js", "e2e/smoke.spec.js",
];

const blueprintSchema = {
  type: "object", additionalProperties: false, required: ["files"],
  properties: { files: { type: "array", items: {
    type: "object", additionalProperties: false,
    required: ["filename", "action", "imports", "exports", "responsibility"],
    properties: {
      filename: { type: "string" }, action: { enum: ["keep", "modify", "create"] },
      imports: { type: "array", items: { type: "string" } },
      exports: { type: "array", items: { type: "string" } }, responsibility: { type: "string" },
    },
  } } },
};
function fileSchema(filename) {
  return { type: "object", additionalProperties: false, required: ["filename", "content"], properties: { filename: { const: filename }, content: { type: "string", minLength: 1 } } };
}

function fileRequirements(filename) {
  if (filename === "package.json") return "content must be a valid package.json document; set its package name to the AppPlan name";
  if (filename.endsWith(".html")) return "content must be a complete HTML document with correctly nested and explicitly balanced non-void tags; preserve required Vite entry scripts";
  if (/\.(?:js|jsx|mjs|ts|tsx)$/.test(filename)) return "content must be syntactically valid source code and follow the blueprint imports and exports";
  if (filename.endsWith(".json")) return "content must be one valid JSON document";
  return "content must be the complete nonempty text of the target file";
}

export function isSafeRelativePath(path) {
  return typeof path === "string" && path.length > 0 && path === posix.normalize(path) &&
    !path.startsWith("/") && path !== ".." && !path.startsWith("../") && !path.includes("\\") &&
    !path.split("/").includes(".") && !path.split("/").includes("..");
}

export async function readTemplate(templateRoot) {
  const files = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files[relative(templateRoot, full).split(sep).join("/")] = await readFile(full, "utf8");
    }
  }
  await walk(templateRoot);
  return files;
}

function validateBlueprint(value, manifest, template) {
  if (!value || Object.keys(value).join(",") !== "files" || !Array.isArray(value.files)) throw new Error("Blueprint must contain only a files array");
  const expected = new Set(manifest);
  const seen = new Set();
  for (const item of value.files) {
    if (Object.keys(item || {}).sort().join(",") !== "action,exports,filename,imports,responsibility") throw new Error(`Blueprint entry has invalid shape: ${item?.filename}`);
    if (!item || !expected.has(item.filename) || seen.has(item.filename)) throw new Error(`Blueprint has unexpected or duplicate file: ${item?.filename}`);
    if (!["keep", "modify", "create"].includes(item.action)) throw new Error(`Blueprint has invalid action for ${item.filename}`);
    if (!Array.isArray(item.imports) || !Array.isArray(item.exports) || typeof item.responsibility !== "string" || !item.responsibility.trim()) throw new Error(`Blueprint entry is incomplete: ${item.filename}`);
    if (item.action === "create" && item.filename in template) throw new Error(`Template file must be keep or modify: ${item.filename}`);
    if (item.action !== "create" && !(item.filename in template)) throw new Error(`New file must use create: ${item.filename}`);
    seen.add(item.filename);
  }
  const missing = manifest.filter((file) => !seen.has(file));
  if (missing.length) throw new Error(`Blueprint missing files: ${missing.join(", ")}`);
  return value;
}

function parseJsonContent(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

export function createGenerationAdapter({ structured = false } = {}) {
  if (structured) return async ({ systemPrompt, userMessage, schema, toolName, maxTokens, model }) => ({
    value: await callLLM({ systemPrompt, userMessage, schema, toolName, temperature: 0.2, maxTokens, model }), usage: {},
  });
  return async ({ systemPrompt, userMessage, maxTokens, model }) => {
    const result = await callChat({ messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }], temperature: 0.2, maxTokens, model });
    return { value: parseJsonContent(result.message?.content), usage: result.usage || {} };
  };
}

export async function generateAppFiles({ appPlan, root, model = process.env.LLM_MODEL || "gpt-4o", invoke = createGenerationAdapter(), maxAttempts = 3 }) {
  const templateRoot = join(root, "templates", "app-template");
  const template = await readTemplate(templateRoot);
  const manifest = appPlan.fileManifest;
  const generationContext = JSON.stringify({ appPlan, model, prompt: BLUEPRINT_PROMPT_VERSION, template });
  const hash = createHash("sha256").update(generationContext).digest("hex");
  const cacheDir = join(root, ".generate-app-cache", appPlan.name, hash);
  await mkdir(join(cacheDir, "files"), { recursive: true });
  const metrics = { generated_files: 0, reused_files: 0, attempts: 0, blueprint_attempts: 0, input_tokens: 0, output_tokens: 0, failed_filename: null, cache_location: cacheDir };
  const addUsage = (usage = {}) => { metrics.input_tokens += usage.prompt_tokens || usage.input_tokens || 0; metrics.output_tokens += usage.completion_tokens || usage.output_tokens || 0; };

  let blueprint;
  try { blueprint = validateBlueprint(JSON.parse(await readFile(join(cacheDir, "blueprint.json"), "utf8")), manifest, template); }
  catch {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      metrics.blueprint_attempts++;
      try {
        const response = await invoke({ systemPrompt: `Create a concise implementation blueprint. Return one JSON object and no commentary or markdown. The top-level object must have exactly one key, "files". Each files entry must have exactly filename, action, imports, exports, and responsibility.`, userMessage: `Assign every manifest file exactly one action (keep, modify, create), imports, exports, and responsibility. Template files may be keep/modify; new files must be create. Modify the entry point and configuration when necessary so every scientific module is reachable and all dependencies are declared.\nAppPlan:\n${JSON.stringify(appPlan)}\nCanonical template:\n${JSON.stringify(template)}`, schema: blueprintSchema, toolName: "create_file_blueprint", maxTokens: 4000, model });
        addUsage(response.usage); blueprint = validateBlueprint(response.value, manifest, template);
        await writeFile(join(cacheDir, "blueprint.json"), JSON.stringify(blueprint, null, 2));
        lastError = null;
        break;
      } catch (error) { lastError = error; }
    }
    if (lastError) {
      metrics.failed_filename = "blueprint";
      await writeFile(join(cacheDir, "failure.json"), JSON.stringify({ stage: "blueprint", attempts: metrics.blueprint_attempts, error: lastError.message, timestamp: new Date().toISOString() }, null, 2));
      const error = new Error(`Failed to create blueprint after ${maxAttempts} attempts: ${lastError.message}`, { cause: lastError }); error.metrics = metrics; throw error;
    }
  }

  const files = {};
  for (const item of blueprint.files) {
    const stamped = template[item.filename]?.replaceAll("APP_NAME", appPlan.name);
    if (item.action === "keep") { files[item.filename] = stamped; continue; }
    const cacheFile = join(cacheDir, "files", encodeURIComponent(item.filename) + ".json");
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8"));
      if (cached.filename !== item.filename || !cached.content?.trim()) throw new Error("invalid cache");
      const checked = await validateFile(item.filename, cached.content); if (!checked.valid) throw new Error(checked.error);
      files[item.filename] = cached.content; metrics.reused_files++; continue;
    } catch {}
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      metrics.attempts++;
      try {
        const retryGuidance = lastError ? `\nThe prior fresh attempt was rejected for this reason: ${lastError.message}\nCorrect that issue without including the prior response.` : "";
        const response = await invoke({ systemPrompt: `Generate exactly one production file. Return one JSON object with exactly two keys: "filename" and "content". filename must be exactly ${JSON.stringify(item.filename)}. content must be the complete raw file text encoded as a JSON string, not markdown and not a second filename. ${fileRequirements(item.filename)}.`, userMessage: `AppPlan:\n${JSON.stringify(appPlan)}\nBlueprint:\n${JSON.stringify(blueprint)}\nTarget filename (copy exactly; never add an extension):\n${item.filename}\nOriginal template content:\n${stamped ?? "(new file)"}${retryGuidance}`, schema: fileSchema(item.filename), toolName: "generate_app_file", maxTokens: 12000, model });
        addUsage(response.usage); const result = response.value;
        if (!result || Object.keys(result).sort().join(",") !== "content,filename" || result.filename !== item.filename || typeof result.content !== "string" || !result.content.trim()) throw new Error("invalid per-file response shape, filename, or content");
        const checked = await validateFile(item.filename, result.content); if (!checked.valid) throw new Error(checked.error);
        files[item.filename] = result.content; metrics.generated_files++; await mkdir(dirname(cacheFile), { recursive: true }); await writeFile(cacheFile, JSON.stringify(result)); lastError = null; break;
      } catch (error) { lastError = error; }
    }
    if (lastError) { metrics.failed_filename = item.filename; await writeFile(join(cacheDir, "failure.json"), JSON.stringify({ stage: "file", filename: item.filename, attempts: maxAttempts, error: lastError.message, timestamp: new Date().toISOString() }, null, 2)); const error = new Error(`Failed to generate ${item.filename} after ${maxAttempts} attempts: ${lastError.message}`); error.metrics = metrics; throw error; }
  }
  const actual = Object.keys(files).sort(); const expected = [...manifest].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Generated files do not exactly cover the manifest");
  return { files, blueprint, metrics };
}
