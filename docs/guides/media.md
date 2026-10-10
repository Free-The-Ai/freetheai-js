---
description: Image and video generation tasks with the FreeTheAI JavaScript SDK.
---

# Images and video

Image and video models run as tasks: you create one, it runs in the background, and you wait for it to finish. Media models appear in `client.models.list()` as they go live.

## Video

```ts
import { writeFile } from "node:fs/promises";

const task = await client.videos.create({
  model: VIDEO_MODEL_ID,
  prompt: "a paper boat drifting on a pond",
  input_reference: "https://example.com/boat.jpg", // or a data: URL
  seconds: "6",
});
await client.tasks.wait(task.id); // polls every 5 s; throws TaskFailedError on failure
await writeFile("boat.mp4", await client.tasks.content(task.id));
```

## Images

```ts
import { writeFile } from "node:fs/promises";

const task = await client.images.generate({
  model: IMAGE_MODEL_ID,
  prompt: "a lighthouse at dusk, watercolor",
});
const finished = await client.tasks.wait(task.id);
for (const [index] of (finished.data ?? []).entries()) {
  await writeFile(`lighthouse-${index}.png`, await client.tasks.content(task.id, { index }));
}
```

## Listing tasks

```ts
for (const task of await client.tasks.list({ limit: 10 })) {
  console.log(task.id, task.status, task.model);
}
```

A task that fails gives its free request back. Outputs are kept for a limited time (`expires_at`).
