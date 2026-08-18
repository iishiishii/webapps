// Extract the component catalog from packages/components/src/ exports.
// Injects available components into the LLM system prompt so it knows
// what shared code exists. Truncates to name + description if over budget.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const COMPONENTS_SRC = "packages/components/src";

/**
 * Extract export names and first-line JSDoc descriptions from index.js files.
 * @param {string} [root] - repo root
 * @returns {Promise<{name: string, module: string, description: string}[]>}
 */
export async function extractCatalog(root = process.cwd()) {
  const srcDir = join(root, COMPONENTS_SRC);
  const entries = await readdir(srcDir, { withFileTypes: true });
  const catalog = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = join(srcDir, entry.name, "index.js");
    let content;
    try {
      content = await readFile(indexPath, "utf8");
    } catch {
      continue;
    }

    // Extract re-exported module names
    const reExports = [
      ...content.matchAll(/export \* from ['"]\.\/([^'"]+)['"]/g),
    ];
    for (const match of reExports) {
      const modName = match[1].replace(/\.js$/, "");
      // Try to read the first JSDoc line from the source file
      let description = "";
      try {
        const modContent = await readFile(
          join(srcDir, entry.name, match[1]),
          "utf8"
        );
        const jsdocMatch = modContent.match(
          /\/\*\*\s*\n\s*\*\s*(.+?)(?:\n|\*\/)/
        );
        if (jsdocMatch) description = jsdocMatch[1].trim();
      } catch {}

      catalog.push({
        name: modName,
        module: `@neurodesk/webapp-components/${entry.name}`,
        description: description || `${modName} from ${entry.name}`,
      });
    }
  }

  return catalog;
}

/**
 * Format catalog for injection into system prompt.
 * @param {{name: string, module: string, description: string}[]} catalog
 * @param {boolean} [compact] - if true, omit descriptions
 * @returns {string}
 */
export function formatCatalog(catalog, compact = false) {
  return catalog
    .map((c) =>
      compact
        ? `- ${c.name} (${c.module})`
        : `- ${c.name} (${c.module}): ${c.description}`
    )
    .join("\n");
}

/**
 * Estimate token count (rough: 1 token ~ 4 chars).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
