---
description: How the FreeTheAI JavaScript SDK handles busy models, concurrency limits, cut-off streams, content filters, and other API behaviour for you.
---

# Reliability

Generic OpenAI clients treat every error the same. This client knows the FreeTheAI API's answers and handles each one the way it should be handled.

| What happens | What the client does |
| --- | --- |
| A model is busy (503 with `Retry-After`) | Tries the next [fallback model](#fallback-models) at once, or waits `Retry-After` (at most 30 s) and retries |
| The account already has as many replies running as its plan allows (429) | [Learns the limit](#concurrency) and queues the rest instead of failing them |
| A long reply without streaming idles past a proxy timeout | Fetches non-streamed chats as a stream and assembles them ([stream transport](#stream-transport)) |
| A stream ends without a finish reason | Throws `StreamInterruptedError` with `.partial`; retries when nothing was shown yet |
| The content filter refuses a request | Throws `ContentFilterError`, or tries the next fallback model |
| A model reads text only and the request has images | Throws `ImagesNotSupportedError`, or tries the next fallback model |
| A model's daily token budget is used up | Throws `ProviderBudgetError`, or tries the next fallback model |
| A model ID is mistyped | Fixes a missing `fta/` prefix; otherwise lists close IDs in `ModelNotFoundError.suggestions` |
| The daily check-in isn't done | Throws `CheckinRequiredError` at once, with `checkinUrl` |
| Today's free requests are used up | Throws `DailyLimitError` at once, with `resetsAt` |
| The key has quotes, spaces, or `Bearer ` around it | Cleans it |
| The key is only part of a key | Throws `IncompleteKeyError` before any request is sent |
| Edge errors during a deploy (HTML 502 or 530 pages) | Retries with backoff, then throws `InternalServerError` |
| Network errors and other 5xx answers | Retries with backoff (`maxRetries`, default 3) |
| A model puts its thinking inside `<think>` tags | Moves it to `reasoning_content` |

Errors that retrying cannot fix (a wrong key, the daily check-in, the daily limit, a bad request) are thrown at once, so you never wait on retries that cannot succeed.

## Fallback models

```ts
const client = new FreeTheAI({ fallbackModels: ["fta/zai/glm-5.3-flash", "fta/mmx/minimax-m3"] });
const reply = await client.chat.completions.create({ model: "fta/kimi/k3", messages });
console.log(reply.model); // the model that answered
```

The chain is tried in order when a model is busy, filtered, can't read the request's images, is over its daily budget, is unknown, or still fails after its retries. Pass `fallbackModels` to `create` to override the list for one call, or `fallbackModels: []` to turn it off.

For streams, fallbacks only happen before the first piece of the reply arrives, so you never get two answers mixed.

## Concurrency

Accounts run a limited number of replies at once (one or two on the free tier). The client starts with no limit. The first time the API refuses a call for concurrency, the client lowers its own limit to the number of replies that were running and queues further calls until a slot frees up. Ten minutes after the last refusal it tries more again, so a plan upgrade is picked up without a restart.

To set a fixed cap instead: `new FreeTheAI({ maxConcurrency: 2 })`.

A stream holds its slot until you finish reading it. Read streams to the end, or stop with `break` in a `for await` loop, which closes them.

## Stream transport

Some proxies close a connection that sends nothing for a while, and a non-streamed request sends nothing until the whole reply is written. With `streamTransport: true` (the default), `create(...)` without `stream: true` asks the API for a stream and assembles it into one ordinary chat completion, with content, reasoning, tool calls, finish reason, and usage. Your code sees no difference.

Turn it off with `new FreeTheAI({ streamTransport: false })` to get the API's own non-streamed answer.

## Error ids

Every API error carries an `errorId` (also sent as the `X-Error-ID` header). Quote it in [Discord](https://discord.gg/secrets) or a support ticket so the exact failure can be found.
