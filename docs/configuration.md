---
description: Configuration options for the FreeTheAI JavaScript SDK client, including keys, base URL, retries, fallback models, concurrency, timeouts, and a custom fetch.
---

# Configuration

```ts
import { FreeTheAI } from "freetheai";

const client = new FreeTheAI({
  apiKey: undefined,          // default: FREETHEAI_API_KEY
  baseURL: undefined,         // default: FREETHEAI_BASE_URL or https://api.freetheai.org/v1
  maxRetries: 3,              // retries per model for retryable errors
  fallbackModels: [],         // models tried in order after the first one fails
  maxConcurrency: undefined,  // fixed cap on replies in flight; learned when left out
  streamTransport: true,      // fetch non-streamed chats as a stream and assemble them
  timeout: 600_000,           // ms to wait for the API to answer
  defaultHeaders: {},         // extra headers on every request
  fetch: undefined,           // your own fetch (proxies, tests, older runtimes)
});
```

| Environment variable | Used for |
| --- | --- |
| `FREETHEAI_API_KEY` | The API key when `apiKey` isn't passed |
| `FREETHEAI_BASE_URL` | The API address when `baseURL` isn't passed |

## Your own fetch

Pass any function with the `fetch` signature. This is how you add a proxy, a custom dispatcher, or a test double:

```ts
const client = new FreeTheAI({
  fetch: (input, init) => fetch(input, { ...init, /* runtime-specific options */ }),
});
```

The client sets the `Authorization` and `User-Agent` headers itself.

## Timeouts

`timeout` covers waiting for the API to answer (the response headers). A stream can keep going after that; it has no overall time limit, so read it to the end or stop it yourself.

## Runtimes

| Runtime | Notes |
| --- | --- |
| Node.js 18+ | Uses the global `fetch` |
| Bun, Deno | Uses the global `fetch` |
| Browsers | Works, but a key in the page is visible to everyone; call the API from your server |
