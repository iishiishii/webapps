// Validation using ASTRA JSON Schema (via Ajv) and @babel/parser for JS syntax.
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CANONICAL_TEMPLATE_FILES = ["package.json", "index.html", "src/main.js", "src/config.js", "vite.config.js", "eslint.config.js", "playwright.config.js", "public/_headers", "test/config.test.js", "e2e/smoke.spec.js"];

let _ajv;
let _validateAnalysis;
let _validateAppPlan;

async function getAppPlanValidator() {
  if (_validateAppPlan) return _validateAppPlan;
  const schemaPath = join(__dirname, "schema", "app-plan.schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  _validateAppPlan = ajv.compile(schema);
  return _validateAppPlan;
}

/** Validate the complete Step 1 output, including its ASTRA analysis. */
export async function validateAppPlan(data) {
  const validate = await getAppPlanValidator();
  const envelopeValid = validate(data);
  const errors = envelopeValid ? [] : [...(validate.errors || [])];
  if (Array.isArray(data?.fileManifest)) {
    const seen = new Set();
    for (const path of data.fileManifest) {
      if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "." || part === "..")) errors.push({ instancePath: "/fileManifest", keyword: "safeRelativePath", message: `unsafe relative path: ${path}` });
      if (typeof path === "string" && /\.(json|html?|jsx?|tsx?|css|ya?ml)\.\1$/i.test(path)) errors.push({ instancePath: "/fileManifest", keyword: "duplicateExtension", message: `duplicate file extension: ${path}` });
      if (seen.has(path)) errors.push({ instancePath: "/fileManifest", keyword: "uniqueItems", message: `duplicate path: ${path}` });
      seen.add(path);
    }
    for (const path of CANONICAL_TEMPLATE_FILES) if (!seen.has(path)) errors.push({ instancePath: "/fileManifest", keyword: "canonicalTemplate", message: `must include ${path}` });
    if (Array.isArray(data.workerMessages) && data.workerMessages.length > 0 && !data.fileManifest.some((path) => /(?:^|\/)workers?[^/]*\.js$/.test(path))) errors.push({ instancePath: "/fileManifest", keyword: "scientificModule", message: "workerMessages require a JavaScript worker module" });
  }

  if (data?.analysis && typeof data.analysis === "object") {
    const analysisResult = await validateAnalysis(data.analysis);
    if (!analysisResult.valid) {
      errors.push(
        ...(analysisResult.errors || []).map((error) => ({
          ...error,
          instancePath: `/analysis${error.instancePath || ""}`,
        })),
      );
    }
  }

  return { valid: errors.length === 0, errors: errors.length ? errors : null };
}

/**
 * Load the ASTRA JSON Schema and compile the Ajv validator.
 * Cached after first call.
 */
async function getAnalysisValidator() {
  if (_validateAnalysis) return _validateAnalysis;
  const schemaPath = join(__dirname, "schema", "astra.schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  _ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateSchema: false,
    formats: { "date-time": true },
  });
  _validateAnalysis = _ajv.compile(schema);
  return _validateAnalysis;
}

/**
 * Validate an object against the ASTRA Analysis JSON Schema.
 * @param {object} data
 * @returns {{ valid: boolean, errors: object[] | null }}
 */
export async function validateAnalysis(data) {
  const validate = await getAnalysisValidator();
  const valid = validate(data);
  return { valid, errors: valid ? null : validate.errors };
}

// Use dynamic import for @babel/parser to avoid top-level await
let _parse;
async function getParser() {
  if (_parse) return _parse;
  const babel = await import("@babel/parser");
  _parse = babel.parse;
  return _parse;
}

/**
 * Validate JS/JSX/TS/TSX source syntax.
 * @param {string} code
 * @param {string} filename
 * @returns {Promise<{ valid: boolean, error: string | null }>}
 */
export async function validateSyntax(code, filename) {
  try {
    const parse = await getParser();
    parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: false,
    });
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: `${filename}: ${err.message}` };
  }
}

/**
 * Validate a generated file based on its extension.
 * @param {string} filename
 * @param {string} content
 * @returns {Promise<{ valid: boolean, error: string | null }>}
 */
export async function validateFile(filename, content) {
  if (filename.endsWith(".json")) {
    try {
      JSON.parse(content);
      return { valid: true, error: null };
    } catch (err) {
      return { valid: false, error: `${filename}: invalid JSON: ${err.message}` };
    }
  }
  if (/\.(js|jsx|ts|tsx|mjs)$/.test(filename)) {
    return validateSyntax(content, filename);
  }
  if (filename.endsWith(".html")) {
    const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
    const sanitized = content.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "<$1></$1>");
    const stack = [];
    for (const match of sanitized.matchAll(/<\s*(\/?)\s*([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
      const closing = Boolean(match[1]);
      const tag = match[2].toLowerCase();
      if (voidElements.has(tag) || (!closing && /\/\s*>$/.test(match[0]))) continue;
      if (!closing) stack.push(tag);
      else if (stack.pop() !== tag) return { valid: false, error: `${filename}: unexpected or misnested closing </${tag}>` };
    }
    if (stack.length) return { valid: false, error: `${filename}: unclosed HTML tag(s): ${stack.join(", ")}` };
    if (!/<html\b/i.test(content) || !/<body\b/i.test(content)) return { valid: false, error: `${filename}: expected a complete document with html and body elements` };
    return { valid: true, error: null };
  }
  // YAML, CSS, etc. -- pass through
  return { valid: true, error: null };
}
