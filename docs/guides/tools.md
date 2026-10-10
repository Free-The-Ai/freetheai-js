---
description: Tool and function calling with the FreeTheAI JavaScript SDK, step by step.
---

# Tool calls

Tools use the OpenAI format.

```ts
import { FreeTheAI, type ChatMessage, type FunctionTool } from "freetheai";

const tools: FunctionTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Current weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
];

const messages: ChatMessage[] = [{ role: "user", content: "Is it raining in Paris?" }];
const first = await client.chat.completions.create({ model: "fta/zai/glm-5.3", messages, tools });
const message = first.choices[0]!.message;
messages.push(message);

for (const call of message.tool_calls ?? []) {
  const args = JSON.parse(call.function.arguments) as { city: string };
  const result = { city: args.city, raining: false }; // call your real function here
  messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
}

const final = await client.chat.completions.create({ model: "fta/zai/glm-5.3", messages, tools });
console.log(final.choices[0]?.message.content);
```

When streaming, tool call pieces arrive in `delta.tool_calls`, keyed by `index`; non-streamed replies come back already assembled.

!!! note "Which models take tools"
    Most models do. If your key is set to *tool-capable models only* on the [API keys page](https://freetheai.org/dashboard/api-keys), `client.models.list()` lists only those.
