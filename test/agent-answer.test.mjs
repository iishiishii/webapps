import assert from "node:assert/strict";
import test from "node:test";
import { extractJsonAnswer } from "../scripts/lib/agent.mjs";

test("extractJsonAnswer accepts prose before a JSON answer", () => {
  const answer = { name: "example", description: "Braces {inside} a string" };
  assert.deepEqual(JSON.parse(extractJsonAnswer(`Here is the complete plan:\n${JSON.stringify(answer)}`)), answer);
});

test("extractJsonAnswer ignores an invalid earlier brace and finds valid JSON", () => {
  assert.deepEqual(JSON.parse(extractJsonAnswer("Use {placeholder} first. Final: {\"ok\":true}")), { ok: true });
});
