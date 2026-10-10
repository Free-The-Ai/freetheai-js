---
description: Chat completions with the FreeTheAI JavaScript SDK - messages, streaming, reasoning, parameters, and images.
---

# Chat and streaming

## A chat completion

```ts
const reply = await client.chat.completions.create({
  model: "fta/zai/glm-5.3",
  messages: [{ role: "user", content: "Name three uses for a paperclip." }],
  temperature: 0.7,
  max_tokens: 400,
});
console.log(reply.choices[0]?.message.content);
```

Any extra field is sent as it is, so every Chat Completions parameter works: `temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `tools`, `tool_choice`, `response_format`, `reasoning_effort`, and `web_search_options`.

## Streaming text

```ts
for await (const text of client.chat.completions.streamText({
  model: "fta/kimi/k3",
  messages: [{ role: "user", content: "Tell me a short story." }],
})) {
  process.stdout.write(text);
}
```

## Streaming chunks

With `stream: true`, `create` resolves to an async iterable of `chat.completion.chunk` objects. The last chunk carries `usage`.

```ts
const stream = await client.chat.completions.create({
  model: "fta/kimi/k3",
  messages,
  stream: true,
});

for await (const chunk of stream) {
  for (const choice of chunk.choices) {
    process.stdout.write(choice.delta.content ?? "");
  }
  if (chunk.usage) console.log("\n", chunk.usage);
}
```

If the stream stops before the model finishes, the loop throws [`StreamInterruptedError`](../errors.md) with the text received so far in `.partial`.

## Reasoning

Thinking models return their reasoning in `message.reasoning_content` (and `delta.reasoning_content` when streaming). Turn thinking off with `reasoning_effort: "none"`:

```ts
const reply = await client.chat.completions.create({
  model: "fta/zai/glm-5.3",
  messages,
  reasoning_effort: "none",
});
```

Some models write their thinking at the start of the reply inside `<think>...</think>`; the client moves it to `reasoning_content` so `content` holds only the answer.

## Images in messages

Models that read images take OpenAI-style content parts:

```ts
const reply = await client.chat.completions.create({
  model: "fta/zai/glm-5.3-flash",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What is in this picture?" },
        { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
      ],
    },
  ],
});
```

A text-only model throws [`ImagesNotSupportedError`](../errors.md); with fallback models set, the next model is tried.

## Which model answered

With [fallback models](../reliability.md#fallback-models), `reply.model` names the model that answered.
