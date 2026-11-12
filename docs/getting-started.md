---
description: Install the FreeTheAI JavaScript SDK, create an API key, add funds, and send your first request from Node.js, Bun, Deno, or the browser.
---

# Getting started

## 1. Install

```bash
npm install freetheai
# or
pnpm add freetheai
# or
bun add freetheai
```

Node.js 18 or newer. The package is ESM with CommonJS and type declarations included.

## 2. Get a key

1. Sign up at [freetheai.org](https://freetheai.org).
2. Open [API keys](https://freetheai.org/dashboard/api-keys) and create a key. It starts with `ftai_` and is shown once, so copy all of it.
3. Add funds to your wallet (from $5, crypto or card) and follow a provider at [freetheai.org/providers](https://freetheai.org/providers). Each request bills the tokens it used at the listed price.

Put the key in the environment:

=== "macOS / Linux"

    ```bash
    export FREETHEAI_API_KEY="ftai_..."
    ```

=== "Windows (PowerShell)"

    ```powershell
    $env:FREETHEAI_API_KEY = "ftai_..."
    ```

!!! warning "Keep keys out of browsers"
    A key in browser code is visible to everyone who opens the page. Call the API from your server, or pass the key in from your own backend.

## 3. Pick a model

A model ID is the model name, such as `glm-5.3`; `<provider>/<model>` picks one provider. Browse them on [freetheai.org/models](https://freetheai.org/models) or list them in code:

```ts
import { FreeTheAI } from "freetheai";

const client = new FreeTheAI();
for (const model of await client.models.list()) {
  console.log(model.id);
}
```

## 4. Send a request

```ts
const reply = await client.chat.completions.create({
  model: "glm-5.3",
  messages: [
    { role: "system", content: "You are a concise assistant." },
    { role: "user", content: "What is an API gateway?" },
  ],
});
console.log(reply.choices[0]?.message.content);
console.log(reply.usage);
```

Replies use the OpenAI Chat Completions shape, with snake_case fields such as `finish_reason` and `tool_calls`.

## Already using the OpenAI SDK?

FreeTheAI speaks the OpenAI wire format, so the `openai` package works with a different base URL:

```ts
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "https://api.freetheai.org/v1", apiKey: "ftai_..." });
```

That gives you the plain client without the handling described on [Reliability](reliability.md).
