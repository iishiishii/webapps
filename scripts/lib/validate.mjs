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
    // Basic tag balance check
    const opens = (content.match(/<[a-z][^/]*>/gi) || []).length;
    const closes = (content.match(/<\/[a-z]+>/gi) || []).length;
    if (Math.abs(opens - closes) > 3) {
      return {
        valid: false,
        error: `${filename}: HTML tag imbalance (${opens} opens, ${closes} closes)`,
      };
    }
    return { valid: true, error: null };
  }
  // YAML, CSS, etc. -- pass through
  return { valid: true, error: null };
}
