// Validation using ASTRA JSON Schema (via Ajv) and @babel/parser for JS syntax.
import Ajv from "ajv";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _ajv;
let _validateAnalysis;

/**
 * Load the ASTRA JSON Schema and compile the Ajv validator.
 * Cached after first call.
 */
async function getAnalysisValidator() {
  if (_validateAnalysis) return _validateAnalysis;
  const schemaPath = join(__dirname, "schema", "astra.schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  _ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
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
