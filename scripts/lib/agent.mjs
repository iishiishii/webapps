// ReAct agent loop for the LLM app-generation pipeline.
// Mirrors replicatorbench/core/agent.py: multi-turn Thought/Action/PAUSE/Observation
// loop with native tool calling.
//
// Uses callChat() from call-llm.mjs (raw fetch, no SDK, any OpenAI-compatible endpoint).
// Tool actions delegate to existing validate.mjs / catalog.mjs where possible.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callChat } from "./call-llm.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Built-in tool actions for the webapp generation agent
// ---------------------------------------------------------------------------

/**
 * Build the known actions map. Each action is an async function that receives
 * the tool's parsed arguments and returns a string result (the Observation).
 *
 * Delegates to existing lib modules where possible:
 *   - catalog.mjs for component listing
 *   - validate.mjs for syntax / schema validation
 *
 * @param {object} opts
 * @param {string} opts.root - repo root
 * @param {{name: string, module: string, description: string}[]} opts.catalog
 * @returns {Record<string, (args: object) => Promise<string>>}
 */
export function buildKnownActions({ root, catalog }) {
  return {
    list_shared_components: async () => JSON.stringify(catalog, null, 2),

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
        const content = await readFile(safePath, "utf8");
        return content.length > 15000
          ? content.slice(0, 15000) + "\n... (truncated)"
          : content;
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
export function buildToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "list_shared_components",
        description: "List all shared components available in @neurodesk/webapp-components.",
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
}

// ---------------------------------------------------------------------------
// ReAct loop
// ---------------------------------------------------------------------------

/**
 * Try to extract a final JSON answer from text content.
 * Supports: Answer: {...}, ```json {...} ```, and raw JSON.
 */
function extractJsonAnswer(text) {
  const answerMatch = text.match(/Answer:\s*(\{.*\})\s*$/s);
  if (answerMatch) return answerMatch[1].trim();

  if (text.includes("```json")) {
    const jsonMatch = text.match(/```json\n(.*?)\n```/s);
    if (jsonMatch) return jsonMatch[1].trim();
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  return null;
}

/**
 * Run the ReAct agent loop.
 *
 * The agent operates in a loop of Thought, Action, PAUSE, Observation until
 * it produces a final Answer JSON or exhausts maxTurns.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt  - full system prompt (preamble + stage instructions)
 * @param {string} opts.question      - initial user message
 * @param {Record<string, Function>} opts.knownActions - tool name -> async fn
 * @param {object[]} opts.tools       - OpenAI-format tool definitions
 * @param {number}  [opts.temperature]
 * @param {number}  [opts.maxTurns]   - default 30
 * @param {boolean} [opts.logTurns]   - default true
 * @param {string}  [opts.model]      - passed through to callChat
 * @param {string}  [opts.baseUrl]    - passed through to callChat
 * @param {string}  [opts.apiKey]     - passed through to callChat
 * @param {function} [opts.onFinal]   - callback on final answer
 * @returns {Promise<{answer: object, metrics: object}>}
 */
export async function runReactLoop({
  systemPrompt,
  question,
  knownActions,
  tools,
  temperature = 0,
  maxTurns = 30,
  logTurns = true,
  model,
  baseUrl,
  apiKey,
  onFinal,
}) {
  const thoughtInstruction =
    "\nIMPORTANT: Before calling any tool, you must output a short 'Thought' explaining your reasoning.";

  const messages = [
    { role: "system", content: systemPrompt + thoughtInstruction },
    { role: "user", content: question },
  ];

  const startTime = Date.now();
  let totalTokens = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const turnMetrics = [];

  for (let i = 0; i < maxTurns; i++) {
    const turnStart = Date.now();

    if (logTurns) {
      console.log(`\n--- Turn ${i + 1} ---`);
    }

    // Call the LLM via generic callChat (raw fetch, no SDK)
    const { message, usage } = await callChat({
      messages,
      tools,
      temperature,
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

        if (logTurns) {
          const logContent =
            resultContent.length > 2000
              ? resultContent.slice(0, 2000) + "\n... (truncated)"
              : resultContent;
          console.log(`Observation (${tc.name}):\n${logContent}`);
        }

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultContent,
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
              turn_history: turnMetrics,
            },
          };
        } catch (err) {
          console.error(`Error parsing final answer: ${err.message}`);
          messages.push({
            role: "user",
            content: `Your answer was not valid JSON. Error: ${err.message}. Please fix and provide the Answer again.`,
          });
        }
      } else if (i === 0) {
        messages.push({
          role: "user",
          content: "Reminder: Please use the available tools or provide the final Answer JSON.",
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

  console.warn("Max turns reached without a final answer.");
  return {
    answer: { error: "Max turns reached without a final answer." },
    metrics: {
      status: "failed_max_turns",
      total_time_ms: Date.now() - startTime,
      total_tokens: totalTokens,
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      total_turns: maxTurns,
      turn_history: turnMetrics,
    },
  };
}
