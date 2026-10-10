---
description: API reference for the FreeTheAI JavaScript SDK, listing the client, its resources, methods, and exported error classes.
---

# API reference

## Client

`new FreeTheAI(options?)` takes the [configuration options](configuration.md).

| Member | Signature |
| --- | --- |
| `client.apiKey` | The cleaned key in use |
| `client.baseURL` | The API address in use |
| `client.search` | `search({ query, num_results? }): Promise<WebSearchResponse>` |
| `client.answer` | `answer({ query, num_results? }): Promise<WebAnswerResponse>` |

## Resources

| Resource | Methods |
| --- | --- |
| `client.chat.completions` | `create(params): Promise<ChatCompletion>`, or `create({ ..., stream: true }): Promise<AsyncIterable<ChatCompletionChunk>>`; `streamText(params): AsyncGenerator<string>` |
| `client.models` | `list(): Promise<Model[]>` |
| `client.tasks` | `list({ limit? })`, `get(id)`, `wait(id, { pollIntervalMs?, timeoutMs? })`, `content(id, { index? }): Promise<Uint8Array>` |
| `client.videos` | `create({ model, prompt?, input_reference?, seconds?, size? })` |
| `client.images` | `generate({ model, prompt, n?, size?, response_format?, image? })` |

Chat parameters are sent as they are, with the API's snake_case names: `temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `tools`, `tool_choice`, `response_format`, `reasoning_effort`, and `web_search_options`. Add `fallbackModels` to a single call to override the client's list.

Media and search calls return the API's JSON. `tasks.wait` resolves with the finished task, or rejects with `TaskFailedError`.

## Types

Every request and response type is exported: `ChatCompletionCreateParams`, `ChatCompletion`, `ChatCompletionChunk`, `ChatMessage`, `ToolCall`, `FunctionTool`, `Usage`, `Model`, `MediaTask`, `VideoCreateParams`, `ImageGenerateParams`, `WebSearchResponse`, `WebAnswerResponse`, and more.

## Errors

Every error class is exported from the package root. See [Errors](errors.md) for the full list and when each one is thrown.
