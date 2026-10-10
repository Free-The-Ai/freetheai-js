---
description: Official JavaScript and TypeScript SDK for FreeTheAI, the free OpenAI-compatible AI API, with built-in retries, fallback models, and rate-limit handling. Zero dependencies.
---

# FreeTheAI JavaScript SDK

![FreeTheAI JavaScript SDK](assets/banner.jpg)

`freetheai` is the official JavaScript and TypeScript client for [FreeTheAI](https://freetheai.org), a free OpenAI-compatible AI API. One key gives you dozens of chat models, streaming, tool calls, web search with sourced answers, and image and video tasks. It has no runtime dependencies: it uses the global `fetch` and runs on Node.js 18+, Bun, Deno, and modern browsers.

```bash
npm install freetheai
```

```ts
import { FreeTheAI } from "freetheai";

const client = new FreeTheAI(); // reads FREETHEAI_API_KEY

const reply = await client.chat.completions.create({
  model: "fta/zai/glm-5.3",
  messages: [{ role: "user", content: "Write a haiku about open models." }],
});
console.log(reply.choices[0]?.message.content);
```

## Why use it instead of a generic OpenAI client

The client is written around how the FreeTheAI API actually behaves, so your code gets answers instead of retry logic:

- **Busy models** are retried after the server's `Retry-After`, or skipped for the next of your [fallback models](reliability.md#fallback-models).
- **The per-account concurrency limit** is learned on the first refusal; extra calls wait their turn instead of failing.
- **Long replies** are fetched as a stream and assembled, so they never hit an idle timeout.
- **Cut-off streams** throw an error with the partial text instead of returning a short answer.
- **Daily check-in and daily limits** throw their own errors at once, with the link or reset time you need.
- **Typos in model IDs** come back with suggestions, and a missing `fta/` prefix is fixed for you.

The full list is on [Reliability](reliability.md).

## Where to next

- [Getting started](getting-started.md): key, check-in, first request
- [Chat and streaming](guides/chat.md): messages, streaming, reasoning, parameters
- [Tool calls](guides/tools.md): function calling, step by step
- [Web search](guides/web-search.md): search results and sourced answers
- [Errors](errors.md): every error class and when it happens

Need help? Ask in [Discord](https://discord.gg/secrets) and include the `errorId` from the error.
