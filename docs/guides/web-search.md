---
description: Web search and sourced answers with the FreeTheAI JavaScript SDK.
---

# Web search

Two endpoints, both counted against a daily web search allowance (each response shows `daily_used` and `daily_limit`).

## Search results

```ts
const results = await client.search({ query: "node.js 22 release notes", num_results: 5 });
for (const hit of results.results) {
  console.log(hit.title, hit.url);
  console.log((hit.text ?? "").slice(0, 200));
}
```

## Answers with sources

```ts
const answer = await client.answer({ query: "What changed in Node.js 22?" });
console.log(answer.answer);
for (const source of answer.sources) {
  console.log("-", source.title, source.url);
}
```

## Search inside a chat

Models with built-in search take `web_search_options: {}`; their sources come back as `annotations` on the message:

```ts
const reply = await client.chat.completions.create({
  model: "fta/zai/glm-5.3",
  messages: [{ role: "user", content: "What is the weather in Tokyo today?" }],
  web_search_options: {},
});
console.log(reply.choices[0]?.message.annotations);
```

For any other model, call `client.search(...)` and pass the results to the model yourself.
