// LLM provider abstraction. Supports Anthropic and OpenAI-compatible APIs.
// Provider is selected via LLM_PROVIDER env var (default: anthropic).
// Model is selected via LLM_MODEL env var or the model parameter.
//
// Two call modes:
//   callLLM()  — single-shot structured output via forced tool_use (existing)
//   callChat() — multi-turn chat completions via OpenAI-compatible API (ReAct)
//
// callChat() uses raw fetch against any OpenAI-compatible endpoint:
//   OpenAI, vLLM, Ollama, together.ai, llama.cpp, etc.
// Configure via:
//   LLM_BASE_URL  — API base (default: https://api.openai.com/v1)
//   LLM_API_KEY   — Bearer token (falls back to OPENAI_API_KEY)
//   LLM_MODEL     — model ID (default: gpt-4o)

/**
 * Call the LLM with structured output via tool_use / function calling.
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {object} opts.schema        - JSON Schema for the expected output
 * @param {string} opts.toolName      - tool/function name
 * @param {number} [opts.temperature] - sampling temperature
 * @param {number} [opts.maxTokens]   - max output tokens
 * @param {string} [opts.model]       - model ID override
 * @returns {Promise<object>} parsed structured output
 */
export async function callLLM({
  systemPrompt,
  userMessage,
  schema,
  toolName,
  temperature = 0.2,
  maxTokens = 4096,
  model,
}) {
  const provider = process.env.LLM_PROVIDER || "anthropic";

  if (provider === "openai") {
    return callOpenAI({ systemPrompt, userMessage, schema, toolName, temperature, maxTokens, model });
  }
  return callAnthropic({ systemPrompt, userMessage, schema, toolName, temperature, maxTokens, model });
}

async function callAnthropic({ systemPrompt, userMessage, schema, toolName, temperature, maxTokens, model }) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const response = await client.messages.create({
    model: model || process.env.LLM_MODEL || "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [
      {
        name: toolName,
        description: `Produce structured ${toolName} output`,
        input_schema: schema,
      },
    ],
    tool_choice: { type: "tool", name: toolName },
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock) {
    throw new Error("LLM did not produce tool_use output");
  }
  return toolBlock.input;
}

async function callOpenAI({ systemPrompt, userMessage, schema, toolName, temperature, maxTokens, model }) {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI(); // reads OPENAI_API_KEY from env

  const response = await client.chat.completions.create({
    model: model || process.env.LLM_MODEL || "gpt-4o",
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: toolName,
          description: `Produce structured ${toolName} output`,
          parameters: schema,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: toolName } },
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("LLM did not produce function call output");
  }
  return JSON.parse(toolCall.function.arguments);
}

// ---------------------------------------------------------------------------
// Multi-turn chat completions via raw fetch (OpenAI-compatible, no SDK)
// ---------------------------------------------------------------------------

/**
 * Send a multi-turn chat completion request to any OpenAI-compatible endpoint.
 * Used by the ReAct agent loop — supports tool_choice "auto" and streaming
 * tool calls across turns. No SDK dependency.
 *
 * @param {object} opts
 * @param {object[]} opts.messages  - full message history (system + user + assistant + tool)
 * @param {object[]} [opts.tools]   - OpenAI-format tool definitions
 * @param {number}   [opts.temperature]
 * @param {number}   [opts.maxTokens]
 * @param {string}   [opts.model]
 * @param {string}   [opts.baseUrl]
 * @param {string}   [opts.apiKey]
 * @returns {Promise<{message: object, usage: object}>} assistant message + token usage
 */
export async function callChat({
  messages,
  tools,
  temperature = 0,
  maxTokens = 8192,
  model,
  baseUrl,
  apiKey,
}) {
  const resolvedBase = (
    baseUrl ||
    process.env.LLM_BASE_URL ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");

  const resolvedKey =
    apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";

  const resolvedModel = model || process.env.LLM_MODEL || "gpt-4o";

  const body = {
    model: resolvedModel,
    temperature,
    max_tokens: maxTokens,
    messages,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const headers = { "Content-Type": "application/json" };
  if (resolvedKey) {
    headers["Authorization"] = `Bearer ${resolvedKey}`;
  }

  const res = await fetch(`${resolvedBase}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const msg = data.choices[0].message;

  return {
    message: msg,
    usage: {
      prompt_tokens: data.usage?.prompt_tokens || 0,
      completion_tokens: data.usage?.completion_tokens || 0,
      total_tokens: data.usage?.total_tokens || 0,
    },
  };
}
