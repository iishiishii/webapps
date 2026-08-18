// LLM provider abstraction. Supports Anthropic and OpenAI-compatible APIs.
// Provider is selected via LLM_PROVIDER env var (default: anthropic).
// Model is selected via LLM_MODEL env var or the model parameter.

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
