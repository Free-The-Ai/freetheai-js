/**
 * HTTP transport: one request per call, plus the retry and fallback policy that
 * wraps every call. Internal; use the `FreeTheAI` client instead.
 */

import {
  APIConnectionError,
  type APIStatusError,
  ConcurrencyLimitError,
  FreeTheAIError,
  ModelNotFoundError,
  StreamInterruptedError,
  errorFor,
} from "./errors.js";
import { sleep } from "./internal/sleep.js";
import {
  ChatAssembler,
  ConcurrencyGate,
  type Decision,
  type Json,
  decide,
  fixable,
  interrupted,
  suggestModels,
} from "./resilience.js";
import { readEvents } from "./stream.js";
import type { ChatCompletion, ChatCompletionChunk, Model } from "./types.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://api.freetheai.org/v1";
export const DEFAULT_TIMEOUT_MS = 600_000;
const MODEL_CACHE_MS = 300_000;

export interface TransportConfig {
  apiKey: string;
  baseURL: string;
  maxRetries: number;
  fallbackModels: string[];
  maxConcurrency: number | null;
  streamTransport: boolean;
  timeoutMs: number;
  defaultHeaders: Record<string, string>;
  fetch: typeof fetch;
}

interface SendOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** Converts a failed response into the matching error class. */
export async function apiErrorFrom(response: Response): Promise<APIStatusError> {
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return errorFor(response.status, body, text, response.headers);
}

export class Transport {
  readonly config: TransportConfig;
  readonly gate: ConcurrencyGate;
  private readonly headers: Record<string, string>;
  private modelIds: string[] = [];
  private modelIdsAt: number | null = null;

  constructor(config: TransportConfig) {
    this.config = config;
    this.gate = new ConcurrencyGate(config.maxConcurrency);
    this.headers = {
      Authorization: `Bearer ${config.apiKey}`,
      "User-Agent": `freetheai-js/${VERSION}`,
      ...config.defaultHeaders,
    };
  }

  /** The model chain for one call: the model, then the fallbacks (no repeats). */
  chainFor(model: string, override?: string[]): string[] {
    const chain = [model];
    for (const extra of override ?? this.config.fallbackModels) {
      if (!chain.includes(extra)) chain.push(extra);
    }
    return chain;
  }

  /** One HTTP call, no retries. Throws APIConnectionError or an APIStatusError. */
  async send(method: "GET" | "POST", path: string, options: SendOptions = {}): Promise<Response> {
    let url = this.config.baseURL + path;
    if (options.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const query = params.toString();
      if (query) url += `?${query}`;
    }
    const headers: Record<string, string> = { ...this.headers };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await this.config.fetch(url, { method, headers, body, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new APIConnectionError("the request timed out");
      const reason = error instanceof Error ? error.message : String(error);
      throw new APIConnectionError(`could not reach the API: ${reason}`);
    } finally {
      // The timeout covers waiting for the response headers; a stream can run on.
      clearTimeout(timer);
    }
    if (response.status >= 400) throw await apiErrorFrom(response);
    return response;
  }

  /** Runs `attempt` per model with the retry and fallback rules. */
  async policy<T>(
    models: string[],
    attempt: (model: string) => Promise<T>,
    options: { gated: boolean; hold?: boolean },
  ): Promise<T> {
    const { gated, hold = false } = options;
    let last: unknown;
    let index = 0;
    while (index < models.length) {
      let tries = 0;
      let moveOn = false;
      while (!moveOn) {
        if (gated) await this.gate.acquire();
        let decision: Decision = { action: "raise", delayMs: 0 };
        try {
          const result = await attempt(models[index] as string);
          // A held slot (a stream) is released by the stream when it ends.
          if (gated && !hold) this.gate.release();
          return result;
        } catch (error) {
          if (gated) {
            if (error instanceof ConcurrencyLimitError) this.gate.refused();
            this.gate.release();
          }
          if (!(error instanceof FreeTheAIError)) throw error;
          const current = models[index] ?? "";
          if (error instanceof ModelNotFoundError && current) {
            const fixed = await this.suggest(error, current);
            if (fixed && !models.includes(fixed)) {
              models[index] = fixed;
              continue;
            }
          }
          decision = decide(error, tries, this.config.maxRetries, index + 1 < models.length);
          if (decision.action === "raise") throw error;
          last = error;
        }
        if (decision.action === "fallback") {
          moveOn = true;
          break;
        }
        tries += 1;
        await sleep(decision.delayMs);
      }
      index += 1;
    }
    throw last ?? new FreeTheAIError("no model answered");
  }

  /** A JSON call with the retry rules (no concurrency gate). */
  async request<T>(method: "GET" | "POST", path: string, options: SendOptions = {}): Promise<T> {
    const response = await this.policy([""], () => this.send(method, path, options), { gated: false });
    return (await response.json()) as T;
  }

  /** A call whose answer is raw bytes (images, videos). */
  async bytes(path: string, query: Record<string, string | number | undefined>): Promise<Uint8Array> {
    const response = await this.policy([""], () => this.send("GET", path, { query }), { gated: false });
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Looks up close model IDs after an unknown model; the list is cached for five minutes. */
  async suggest(error: ModelNotFoundError, model: string): Promise<string | null> {
    try {
      if (this.modelIdsAt === null || Date.now() - this.modelIdsAt > MODEL_CACHE_MS) {
        const response = await this.send("GET", "/models");
        const payload = (await response.json()) as { data: Model[] };
        this.modelIds = payload.data.map((entry) => entry.id);
        this.modelIdsAt = Date.now();
      }
    } catch {
      return null;
    }
    error.suggestions = suggestModels(model, this.modelIds);
    if (error.suggestions.length > 0) {
      error.message += ` Did you mean: ${error.suggestions.join(", ")}?`;
    }
    return fixable(model, error.suggestions);
  }

  /** A non-streamed chat: with the stream transport on, it is streamed and assembled. */
  async chat(models: string[], body: Json): Promise<ChatCompletion> {
    return this.policy(
      models,
      async (model) => {
        const payload = { ...body, model };
        if (!this.config.streamTransport) {
          const response = await this.send("POST", "/chat/completions", { body: payload });
          return (await response.json()) as ChatCompletion;
        }
        const response = await this.send("POST", "/chat/completions", { body: { ...payload, stream: true } });
        const assembler = new ChatAssembler();
        if (!response.body) throw interrupted(assembler);
        try {
          for await (const event of readEvents(response.body)) assembler.feed(event);
        } catch (error) {
          if (error instanceof FreeTheAIError) throw error;
          throw interrupted(assembler);
        }
        if (!assembler.finished) throw interrupted(assembler);
        return assembler.result() as ChatCompletion;
      },
      { gated: true },
    );
  }

  /** A streamed chat. Resolves once the first chunk with a reply has arrived. */
  async chatStream(models: string[], body: Json): Promise<AsyncGenerator<ChatCompletionChunk, void, void>> {
    const opened = await this.policy(
      models,
      async (model) => {
        const response = await this.send("POST", "/chat/completions", {
          body: { ...body, model, stream: true },
        });
        if (!response.body) throw new StreamInterruptedError("the reply stream ended before any reply");
        const events = readEvents(response.body);
        const first: Json[] = [];
        try {
          for (;;) {
            const next = await events.next();
            if (next.done) throw new StreamInterruptedError("the reply stream ended before any reply");
            first.push(next.value);
            if (next.value.choices?.length) break;
          }
        } catch (error) {
          await events.return(undefined).catch(() => undefined);
          throw error instanceof FreeTheAIError ? error : interrupted(new ChatAssembler());
        }
        return { events, first };
      },
      { gated: true, hold: true },
    );
    return this.relay(opened.events, opened.first);
  }

  /** Yields the events of an open stream and frees the concurrency slot when it ends. */
  private async *relay(
    events: AsyncGenerator<Json, void, void>,
    first: Json[],
  ): AsyncGenerator<ChatCompletionChunk, void, void> {
    const assembler = new ChatAssembler();
    try {
      for (const event of first) {
        assembler.feed(event);
        yield event as ChatCompletionChunk;
      }
      for (;;) {
        const next = await events.next();
        if (next.done) break;
        assembler.feed(next.value);
        yield next.value as ChatCompletionChunk;
      }
      if (!assembler.finished) throw interrupted(assembler);
    } catch (error) {
      if (error instanceof StreamInterruptedError) {
        error.partial = assembler.text();
        throw error;
      }
      if (error instanceof FreeTheAIError) throw error;
      throw interrupted(assembler);
    } finally {
      await events.return(undefined).catch(() => undefined);
      this.gate.release();
    }
  }
}
