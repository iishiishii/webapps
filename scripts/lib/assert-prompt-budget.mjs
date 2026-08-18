#!/usr/bin/env node
// Asserts the Step 1 system prompt stays under 8,000 tokens.
// Run in CI: node scripts/lib/assert-prompt-budget.mjs
import { extractCatalog, formatCatalog, estimateTokens } from "./catalog.mjs";

const BUDGET = 8000;
const catalog = await extractCatalog(process.cwd());

const fullText = formatCatalog(catalog, false);
const compactText = formatCatalog(catalog, true);
const fullTokens = estimateTokens(fullText);
const compactTokens = estimateTokens(compactText);

console.log(`Component catalog: ${catalog.length} entries`);
console.log(`  Full format:    ~${fullTokens} tokens`);
console.log(`  Compact format: ~${compactTokens} tokens`);

// The actual prompt includes more than just the catalog, but the catalog
// is the variable part. Budget 3000 tokens for catalog, rest for static prompt.
if (compactTokens > 3000) {
  console.error(
    `Compact catalog exceeds 3,000 token budget (${compactTokens}). ` +
      `Reduce the number of exported components or shorten descriptions.`
  );
  process.exit(1);
}

console.log("Prompt budget: OK");
