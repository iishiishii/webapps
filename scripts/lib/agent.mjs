// Agentic tool-calling loop for the LLM app-generation pipeline.
// Uses native OpenAI-compatible tool calling (tool_choice: "auto") via
// callChat() from call-llm.mjs (raw fetch, no SDK, any compatible endpoint).
// Tool actions delegate to existing validate.mjs / catalog.mjs where possible.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callChat } from "./call-llm.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_TEMPLATE_FILES = [
  "package.json",
  "index.html",
  "src/main.js",
  "src/config.js",
  "vite.config.js",
  "eslint.config.js",
  "playwright.config.js",
  "public/_headers",
  "test/config.test.js",
  "e2e/smoke.spec.js",
];

// ---------------------------------------------------------------------------
// Built-in tool actions for the webapp generation agent
// ---------------------------------------------------------------------------

/**
 * Build the known actions map. Each action is an async function that receives
 * the tool's parsed arguments and returns a string result (the Observation).
 *
 * Delegates to existing lib modules where possible:
 *   - validate.mjs for syntax / schema validation
 *
 * There is deliberately no list_shared_components action: the component catalog
 * is already in the system prompt, and serving it again as an Observation cost a
 * round trip plus a second, larger copy of the same data in every later turn.
 *
 * @param {object} opts
 * @param {string} opts.root - repo root
 * @returns {Record<string, (args: object) => Promise<string>>}
 */
export function buildKnownActions({ root }) {
  return {
    read_app_template: async () => {
      const templateRoot = join(root, "templates", "app-template");
      const contents = await Promise.all(
        APP_TEMPLATE_FILES.map(async (file) => {
          try {
            return `--- ${file} ---\n${await readFile(join(templateRoot, file), "utf8")}`;
          } catch (err) {
            return `--- ${file} ---\nError: ${err.message}`;
          }
        }),
      );
      return contents.join("\n\n");
    },

    list_existing_apps: async () => {
      const entries = await readdir(join(root, "apps"), { withFileTypes: true });
      return JSON.stringify(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    },

    read_app_source: async ({ app, file }) => {
      const safePath = join(root, "apps", app, file);
      if (!safePath.startsWith(join(root, "apps"))) {
        return "Error: path escapes apps/ directory.";
      }
      try {
        // Not truncated here: runReactLoop caps every Observation centrally, so
        // there is one knob rather than a per-tool limit that drifts out of sync.
        return await readFile(safePath, "utf8");
      } catch (err) {
        return `Error reading ${app}/${file}: ${err.message}`;
      }
    },

    list_app_files: async ({ app }) => {
      try {
        const entries = await readdir(join(root, "apps", app), { recursive: true });
        return JSON.stringify(entries.slice(0, 200));
      } catch (err) {
        return `Error listing ${app}: ${err.message}`;
      }
    },

    validate_astra_schema: async ({ data }) => {
      try {
        const { validateAnalysis } = await import("./validate.mjs");
        const { valid, errors } = await validateAnalysis(data);
        return valid ? "Valid." : `Invalid: ${JSON.stringify(errors, null, 2)}`;
      } catch (err) {
        return `Validation error: ${err.message}`;
      }
    },

    validate_syntax: async ({ filename, content }) => {
      try {
        const { validateFile } = await import("./validate.mjs");
        const result = await validateFile(filename, content);
        return result.valid ? "Valid." : `Invalid: ${result.error}`;
      } catch (err) {
        return `Validation error: ${err.message}`;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI-compatible function-calling format)
// ---------------------------------------------------------------------------

/** @returns {object[]} */
export function buildToolDefinitions(names) {
  const definitions = [
    {
      type: "function",
      function: {
        name: "read_app_template",
        description:
          "Read the complete canonical templates/app-template scaffold used for new apps.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "list_existing_apps",
        description: "List all existing app names in the monorepo apps/ directory.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "read_app_source",
        description: "Read a source file from an existing app for reference.",
        parameters: {
          type: "object",
          properties: {
            app: { type: "string", description: "App name (e.g. 'calmar')" },
            file: { type: "string", description: "Relative path within the app (e.g. 'web/index.html')" },
          },
          required: ["app", "file"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_app_files",
        description: "List all files in an existing app directory.",
        parameters: {
          type: "object",
          properties: {
            app: { type: "string", description: "App name (e.g. 'calmar')" },
          },
          required: ["app"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "validate_astra_schema",
        description: "Validate a JSON object against the ASTRA Analysis JSON Schema.",
        parameters: {
          type: "object",
          properties: {
            data: { type: "object", description: "ASTRA Analysis object to validate" },
          },
          required: ["data"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "validate_syntax",
        description: "Validate JS/TS/HTML/JSON file syntax.",
        parameters: {
          type: "object",
          properties: {
            filename: { type: "string", description: "Filename with extension (e.g. 'App.tsx')" },
            content: { type: "string", description: "File content to validate" },
          },
          required: ["filename", "content"],
        },
      },
    },
  ];
  if (!names) return definitions;
  const allowed = new Set(names);
  return definitions.filter(({ function: definition }) =>
    allowed.has(definition.name),
  );
}

// ---------------------------------------------------------------------------
// Agentic tool-calling loop
// ---------------------------------------------------------------------------

/**
 * Cap an Observation before it enters the conversation.
 *
 * Tool results are re-sent to the model on every subsequent turn, so an oversized
 * Observation is not paid once - it is paid (turns remaining) times. A 15KB file
 * read landing on turn 3 of a 9-turn run costs ~26k tokens by itself.
 *
 * @param {string} text
 * @param {number} limit - max characters kept
 * @param {string} toolName
 * @returns {string}
 */
function truncateObservation(text, limit, toolName) {
  if (text.length <= limit) return text;
  return (
    text.slice(0, limit) +
    `\n... (truncated: ${toolName} returned ${text.length} chars, showing the first ${limit}.` +
    ` Narrow your request if you need the rest.)`
  );
}

/**
 * Try to extract a final JSON answer from text content.
 * Supports: Answer: {...}, ```json {...} ```, and raw JSON.
 */
export function extractJsonAnswer(text) {
  const answerMatch = text.match(/Answer:\s*(\{.*\})\s*$/s);
  if (answerMatch) return answerMatch[1].trim();

  if (text.includes("```json")) {
    const jsonMatch = text.match(/```json\n(.*?)\n```/s);
    if (jsonMatch) return jsonMatch[1].trim();
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  // Some OpenAI-compatible models prefix an otherwise valid answer with a
  // sentence such as "Here is the plan:". Find the first balanced JSON object
  // without being confused by braces or escaped quotes inside JSON strings.
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        const candidate = text.slice(start, i + 1);
        try { JSON.parse(candidate); return candidate; } catch { break; }
      }
    }
  }

  return null;
}

/**
 * Run the agentic tool-calling loop.
 *
 * The agent calls tools via native OpenAI-compatible function calling until
 * it produces a final Answer JSON or exhausts maxTurns.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt  - full system prompt (preamble + stage instructions)
 * @param {string} opts.question      - initial user message
 * @param {Record<string, Function>} opts.knownActions - tool name -> async fn
 * @param {object[]} opts.tools       - OpenAI-format tool definitions
 * @param {number}  [opts.temperature]
 * @param {number}  [opts.maxTurns]   - default 30
 * @param {number}  [opts.maxTokens]  - maximum completion tokens per turn
 * @param {number}  [opts.maxToolTurns] - disable tools after this many tool-calling turns
 * @param {number}  [opts.maxObservationChars] - default 6000. Cap on the tool result stored in
 *   the conversation (not just logged). Every stored character is re-sent on every later turn.
 * @param {boolean} [opts.logTurns]   - default true
 * @param {string}  [opts.model]      - passed through to callChat
 * @param {string}  [opts.baseUrl]    - passed through to callChat
 * @param {string}  [opts.apiKey]     - passed through to callChat
 * @param {function} [opts.onFinal]   - callback on final answer
 * @param {function} [opts.validateAnswer] - async (answer) => { ok: boolean, feedback?: string }.
 *   Gate on the final Answer. When it returns { ok: false }, `feedback` is pushed back into the
 *   conversation as an Observation and the loop continues, so the agent repairs its answer in
 *   place instead of the caller discarding a whole run's worth of context.
 * @returns {Promise<{answer: object, metrics: object}>}
 */
export async function runReactLoop({
  systemPrompt,
  question,
  knownActions,
  tools,
  temperature = 0,
  maxTurns = 30,
  maxTokens = 8192,
  maxToolTurns = Infinity,
  maxObservationChars = 6000,
  logTurns = true,
  model,
  baseUrl,
  apiKey,
  onFinal,
  validateAnswer,
}) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: question },
  ];

  const startTime = Date.now();
  let totalTokens = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const turnMetrics = [];
  let rejectedAnswers = 0;
  let toolTurns = 0;

  for (let i = 0; i < maxTurns; i++) {
    const turnStart = Date.now();

    if (logTurns) {
      console.log(`\n--- Turn ${i + 1} ---`);
    }

    // Call the LLM via generic callChat (raw fetch, no SDK)
    const availableTools = toolTurns < maxToolTurns ? tools : [];
    const { message, usage } = await callChat({
      messages,
      tools: availableTools,
      temperature,
      maxTokens,
      model,
      baseUrl,
      apiKey,
    });

    // Append assistant message for multi-turn continuity
    messages.push(message);

    const turnPrompt = usage.prompt_tokens;
    const turnCompletion = usage.completion_tokens;
    const turnTotal = usage.total_tokens;
    totalPromptTokens += turnPrompt;
    totalCompletionTokens += turnCompletion;
    totalTokens += turnTotal;

    const contentText = message.content || "";
    const toolCalls = (message.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    }));

    // Log the Thought
    if (logTurns && contentText.trim()) {
      console.log(`Agent Thought:\n${contentText}`);
    }

    let action = null;

    // Branch 1: Tool calls present — execute and feed Observations back
    if (toolCalls.length > 0) {
      toolTurns += 1;
      action = toolCalls[0].name;

      if (logTurns) {
        console.log(` -- Running Action(s): ${toolCalls.length} tool(s). Primary: ${action}`);
      }

      for (const tc of toolCalls) {
        let resultContent;
        if (tc.name in knownActions) {
          try {
            resultContent = await knownActions[tc.name](tc.args);
          } catch (err) {
            resultContent = `Error executing ${tc.name}: ${err.message}`;
            console.error(resultContent);
          }
        } else {
          resultContent = `Error: Tool ${tc.name} not found.`;
        }

        // Cap the stored Observation, then log from the stored copy so the console
        // shows what the model actually receives.
        const storedContent = truncateObservation(
          resultContent,
          maxObservationChars,
          tc.name
        );

        if (logTurns) {
          const logContent =
            storedContent.length > 2000
              ? storedContent.slice(0, 2000) + "\n... (truncated in log)"
              : storedContent;
          console.log(`Observation (${tc.name}):\n${logContent}`);
          if (storedContent.length < resultContent.length) {
            console.log(
              `  [dropped ${resultContent.length - storedContent.length} chars before sending to the model]`
            );
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: storedContent,
        });
      }
    }
    // Branch 2: No tools — check for final Answer JSON
    else {
      const jsonAnswerStr = extractJsonAnswer(contentText);

      if (jsonAnswerStr) {
        try {
          const jsonStart = jsonAnswerStr.indexOf("{");
          const jsonEnd = jsonAnswerStr.lastIndexOf("}");
          const finalAnswer = JSON.parse(jsonAnswerStr.slice(jsonStart, jsonEnd + 1));

          const verdict = validateAnswer ? await validateAnswer(finalAnswer) : null;

          if (verdict && verdict.ok === false) {
            // Repair in place: hand the errors back and keep the accumulated
            // context rather than throwing the whole run away.
            rejectedAnswers += 1;
            console.warn(
              `\n--- Answer rejected (${rejectedAnswers}); asking the agent to fix it ---`
            );
            messages.push({
              role: "user",
              content:
                verdict.feedback ||
                "Your Answer failed validation. Fix it and provide the Answer again.",
            });
          } else {
            console.log("\n--- Final Answer Found ---");
            if (onFinal) onFinal(finalAnswer);

            return {
              answer: finalAnswer,
              metrics: {
                status: "success",
                total_time_ms: Date.now() - startTime,
                total_tokens: totalTokens,
                prompt_tokens: totalPromptTokens,
                completion_tokens: totalCompletionTokens,
                total_turns: i + 1,
                rejected_answers: rejectedAnswers,
                turn_history: turnMetrics,
              },
            };
          }
        } catch (err) {
          console.error(`Error parsing final answer: ${err.message}`);
          messages.push({
            role: "user",
            content: `Your answer was not valid JSON. Error: ${err.message}. Please fix and provide the Answer again.`,
          });
        }
      } else {
        messages.push({
          role: "user",
          content: "No complete JSON answer was detected. Provide the complete AppPlan now as one JSON object, with no prose and no tool call.",
        });
      }
    }

    turnMetrics.push({
      turn: i + 1,
      action: action || "none",
      duration_ms: Date.now() - turnStart,
      prompt_tokens: turnPrompt,
      completion_tokens: turnCompletion,
      total_tokens: turnTotal,
    });
  }

  const exhaustedReason = rejectedAnswers
    ? `Max turns reached; the last ${rejectedAnswers} answer(s) failed validation.`
    : "Max turns reached without a final answer.";
  console.warn(exhaustedReason);
  return {
    answer: { error: exhaustedReason },
    metrics: {
      status: rejectedAnswers ? "failed_validation" : "failed_max_turns",
      rejected_answers: rejectedAnswers,
      total_time_ms: Date.now() - startTime,
      total_tokens: totalTokens,
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      total_turns: maxTurns,
      turn_history: turnMetrics,
    },
  };
}
