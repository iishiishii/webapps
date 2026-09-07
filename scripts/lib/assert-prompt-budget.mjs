#!/usr/bin/env node
// Asserts the Step 1 system prompt stays under 8,000 tokens.
// Run in CI: node scripts/lib/assert-prompt-budget.mjs
import { extractCatalog, formatCatalog, estimateTokens } from "./catalog.mjs";
import { PLAN, PREAMBLE } from "./prompts.mjs";

const BUDGET = 8000;
const catalog = await extractCatalog(process.cwd());

const fullText = formatCatalog(catalog, false);
const compactText = formatCatalog(catalog, true);
const fullTokens = estimateTokens(fullText);
const compactTokens = estimateTokens(compactText);
const fullPromptTokens = estimateTokens(
  [PREAMBLE, PLAN, `Available shared components:\n${fullText}`].join("\n"),
);
const compactPromptTokens = estimateTokens(
  [PREAMBLE, PLAN, `Available shared components:\n${compactText}`].join("\n"),
);

console.log(`Component catalog: ${catalog.length} entries`);
console.log(`  Full format:    ~${fullTokens} tokens`);
console.log(`  Compact format: ~${compactTokens} tokens`);
console.log(`Step 1 prompt (full catalog):    ~${fullPromptTokens} tokens`);
console.log(`Step 1 prompt (compact catalog): ~${compactPromptTokens} tokens`);

if (compactPromptTokens > BUDGET) {
  console.error(
    `Compact Step 1 prompt exceeds ${BUDGET.toLocaleString()} token budget ` +
      `(${compactPromptTokens}).`,
  );
  process.exit(1);
}

console.log("Prompt budget: OK");
