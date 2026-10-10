/** The API resources: chat, models, tasks, videos, images, search. Internal wiring for the client. */

import { TaskFailedError } from "./errors.js";
import { sleep } from "./internal/sleep.js";
import type { Json } from "./resilience.js";
import type { Transport } from "./transport.js";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ImageGenerateParams,
  MediaTask,
  Model,
  SearchParams,
  TaskWaitOptions,
  VideoCreateParams,
  WebAnswerResponse,
  WebSearchResponse,
} from "./types.js";

const FINISHED = new Set(["completed", "failed", "cancelled", "expired"]);

/** Splits off `stream` and the per-call fallback list; everything else is sent as is. */
function bodyOf(params: ChatCompletionCreateParams): {
  model: string;
  fallbackModels?: string[];
  body: Json;
} {
  const { model, fallbackModels, stream: _stream, ...rest } = params;
  return { model, fallbackModels, body: rest };
}

export class Completions {
  constructor(private readonly transport: Transport) {}

  /**
   * Creates a chat completion (OpenAI Chat Completions shape).
   * With `stream: true` it resolves to an async iterable of chunks; the last chunk carries `usage`.
   */
  create(params: ChatCompletionCreateParams & { stream: true }): Promise<AsyncIterable<ChatCompletionChunk>>;
  create(params: ChatCompletionCreateParams & { stream?: false }): Promise<ChatCompletion>;
  create(params: ChatCompletionCreateParams): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
  async create(
    params: ChatCompletionCreateParams,
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    const { model, fallbackModels, body } = bodyOf(params);
    const models = this.transport.chainFor(model, fallbackModels);
    if (params.stream) return this.transport.chatStream(models, body);
    return this.transport.chat(models, body);
  }

  /** Streams only the reply text, piece by piece. */
  async *streamText(params: ChatCompletionCreateParams): AsyncGenerator<string, void, void> {
    const stream = await this.create({ ...params, stream: true });
    for await (const chunk of stream) {
      for (const choice of chunk.choices ?? []) {
        const text = choice.delta?.content;
        if (text) yield text;
      }
    }
  }
}

export class Chat {
  readonly completions: Completions;

  constructor(transport: Transport) {
    this.completions = new Completions(transport);
  }
}

export class Models {
  constructor(private readonly transport: Transport) {}

  /** Every model this key can use. `id` is what you pass as `model`. */
  async list(): Promise<Model[]> {
    const payload = await this.transport.request<{ data: Model[] }>("GET", "/models");
    return payload.data;
  }
}

export class Tasks {
  constructor(private readonly transport: Transport) {}

  async list(options: { limit?: number } = {}): Promise<MediaTask[]> {
    const payload = await this.transport.request<{ data: MediaTask[] }>("GET", "/tasks", {
      query: { limit: options.limit },
    });
    return payload.data;
  }

  get(taskId: string): Promise<MediaTask> {
    return this.transport.request<MediaTask>("GET", `/tasks/${encodeURIComponent(taskId)}`);
  }

  /** Polls until the task finishes. Rejects with TaskFailedError on failure or timeout. */
  async wait(taskId: string, options: TaskWaitOptions = {}): Promise<MediaTask> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const timeoutMs = options.timeoutMs ?? 1_800_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const task = await this.get(taskId);
      if (FINISHED.has(task.status)) return finished(task);
      if (Date.now() > deadline) {
        throw new TaskFailedError(`task ${taskId} did not finish in ${Math.round(timeoutMs / 1000)}s`);
      }
      await sleep(pollIntervalMs);
    }
  }

  /** Downloads a finished task's output (image or video bytes). */
  content(taskId: string, options: { index?: number } = {}): Promise<Uint8Array> {
    return this.transport.bytes(`/tasks/${encodeURIComponent(taskId)}/content`, {
      index: options.index ?? 0,
    });
  }
}

export class Videos {
  constructor(private readonly transport: Transport) {}

  /** Starts a video task. Wait for it with `client.tasks.wait(task.id)`. */
  create(params: VideoCreateParams): Promise<MediaTask> {
    return this.transport.request<MediaTask>("POST", "/videos", { body: params });
  }
}

export class Images {
  constructor(private readonly transport: Transport) {}

  /** Starts an image task. Wait for it with `client.tasks.wait(task.id)`. */
  generate(params: ImageGenerateParams): Promise<MediaTask> {
    return this.transport.request<MediaTask>("POST", "/images/generations", { body: params });
  }
}

/** Web search and sourced answers, shared by `client.search` and `client.answer`. */
export function searchWeb(transport: Transport, params: SearchParams): Promise<WebSearchResponse> {
  return transport.request<WebSearchResponse>("POST", "/search", { body: params });
}

export function answerWeb(transport: Transport, params: SearchParams): Promise<WebAnswerResponse> {
  return transport.request<WebAnswerResponse>("POST", "/answer", { body: params });
}

function finished(task: MediaTask): MediaTask {
  if (task.status !== "completed") {
    const error: NonNullable<MediaTask["error"]> = task.error ?? {};
    throw new TaskFailedError(error.message || `task ${task.status}`, {
      code: error.code,
      errorId: error.error_id,
      task,
    });
  }
  return task;
}
