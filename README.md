<p align="center">
  <a href="https://free-the-ai.github.io/freetheai-js/"><img src="https://raw.githubusercontent.com/Free-The-Ai/freetheai-js/main/.github/banner.jpg" alt="FreeTheAI JavaScript and TypeScript SDK" width="100%"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/freetheai"><img src="https://img.shields.io/npm/v/freetheai?color=111111" alt="npm"></a>
  <a href="https://www.npmjs.com/package/freetheai"><img src="https://img.shields.io/node/v/freetheai?color=111111" alt="Node versions"></a>
  <a href="https://github.com/Free-The-Ai/freetheai-js/actions/workflows/ci.yml"><img src="https://github.com/Free-The-Ai/freetheai-js/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-111111" alt="MIT license"></a>
  <a href="https://discord.gg/secrets"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <b><a href="https://free-the-ai.github.io/freetheai-js/">Documentation</a></b> ·
  <a href="https://free-the-ai.github.io/freetheai-js/getting-started/">Getting started</a> ·
  <a href="https://freetheai.org/models">Models</a> ·
  <a href="https://freetheai.org">freetheai.org</a>
</p>

# FreeTheAI JavaScript SDK

The official JavaScript and TypeScript client for [FreeTheAI](https://freetheai.org), a free OpenAI-compatible AI API. One key gives you dozens of chat models, streaming, tool calls, web search with sourced answers, and image and video tasks. It has no runtime dependencies and runs on Node.js 18+, Bun, Deno, and modern browsers.

```bash
npm install freetheai
```

## Quickstart

Create a key at [freetheai.org](https://freetheai.org/dashboard/api-keys), do the [daily check-in](https://freetheai.org/checkin) for free models, and set `FREETHEAI_API_KEY`.

```ts
import { FreeTheAI } from "freetheai";

const client = new FreeTheAI(); // reads FREETHEAI_API_KEY

const reply = await client.chat.completions.create({
  model: "fta/zai/glm-5.3",
  messages: [{ role: "user", content: "Write a haiku about open models." }],
});
console.log(reply.choices[0]?.message.content);
```

Stream it:

```ts
for await (const text of client.chat.completions.streamText({
  model: "fta/kimi/k3",
  messages: [{ role: "user", content: "Tell me a short story." }],
})) {
  process.stdout.write(text);
}
```

Search the web:

```ts
const answer = await client.answer({ query: "What changed in Node.js 22?" });
console.log(answer.answer, answer.sources);
```

## Built for the FreeTheAI API

Generic OpenAI clients treat every error the same. This one knows how the FreeTheAI API answers:

- **Busy models** wait for the server's `Retry-After`, or move straight to your `fallbackModels`.
- **Concurrency limits** are learned on the first refusal; extra calls queue instead of failing.
- **Long replies** are fetched as a stream and assembled, so they don't hit idle timeouts.
- **Cut-off streams** throw `StreamInterruptedError` with the partial text, never a silently short answer.
- **The daily check-in and daily limit** throw `CheckinRequiredError` and `DailyLimitError` at once, with the link or reset time.
- **Mistyped model IDs** come back with suggestions; a missing `fta/` prefix is fixed for you.

```ts
const client = new FreeTheAI({ fallbackModels: ["fta/zai/glm-5.3-flash", "fta/mmx/minimax-m3"] });
```

Read [Reliability](https://free-the-ai.github.io/freetheai-js/reliability/) for the full list.

## Documentation

| Guide | |
| --- | --- |
| [Getting started](https://free-the-ai.github.io/freetheai-js/getting-started/) | Key, check-in, first request |
| [Chat and streaming](https://free-the-ai.github.io/freetheai-js/guides/chat/) | Parameters, streaming, reasoning, images |
| [Tool calls](https://free-the-ai.github.io/freetheai-js/guides/tools/) | Function calling step by step |
| [Web search](https://free-the-ai.github.io/freetheai-js/guides/web-search/) | Results and sourced answers |
| [Images and video](https://free-the-ai.github.io/freetheai-js/guides/media/) | Media tasks |
| [Errors](https://free-the-ai.github.io/freetheai-js/errors/) | Every error class and what to do |
| [Configuration](https://free-the-ai.github.io/freetheai-js/configuration/) | All client options |

## More from FreeTheAI

- [Python SDK](https://github.com/Free-The-Ai/freetheai-python) and [Go SDK](https://github.com/Free-The-Ai/freetheai-go)
- [Cookbook](https://github.com/Free-The-Ai/freetheai-cookbook): runnable examples
- [Setup guides](https://freetheai.org/setup) for SillyTavern, JanitorAI, Claude Code, Cline, and more
- [API status](https://freetheai.org/status) and [Discord](https://discord.gg/secrets)

## License

MIT. Built by [Vibhek Soni](https://vibheksoni.com).
