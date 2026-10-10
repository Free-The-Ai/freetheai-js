import { FreeTheAIError } from "./errors.js";
import { cleanKey } from "./resilience.js";
import { Chat, Images, Models, Tasks, Videos, answerWeb, searchWeb } from "./resources.js";
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, Transport } from "./transport.js";
import type { SearchParams, WebAnswerResponse, WebSearchResponse } from "./types.js";

export interface FreeTheAIOptions {
  /** Your API key. Defaults to the FREETHEAI_API_KEY environment variable. */
  apiKey?: string;
  /** The API address. Defaults to FREETHEAI_BASE_URL, then https://api.freetheai.org/v1. */
  baseURL?: string;
  /** Retries per model for retryable errors (network, 5xx, generic 429). Default 3. */
  maxRetries?: number;
  /** Models tried in order after the first one fails (busy, filtered, unknown, or still failing). */
  fallbackModels?: string[];
  /** A fixed cap on replies in flight. Left out, the client learns the account's limit itself. */
  maxConcurrency?: number;
  /** Fetch non-streamed chats as a stream and assemble them, so long replies never idle out. Default true. */
  streamTransport?: boolean;
  /** Milliseconds to wait for the API to answer (headers). Default 600000. */
  timeout?: number;
  /** Extra headers on every request. */
  defaultHeaders?: Record<string, string>;
  /** A custom fetch (proxies, tests, runtimes without a global fetch). */
  fetch?: typeof fetch;
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.[name];
  return value ? value : undefined;
}

/**
 * Client for the FreeTheAI API.
 *
 * ```ts
 * import { FreeTheAI } from "freetheai";
 *
 * const client = new FreeTheAI(); // reads FREETHEAI_API_KEY
 * const reply = await client.chat.completions.create({
 *   model: "fta/zai/glm-5.3",
 *   messages: [{ role: "user", content: "Hello!" }],
 * });
 * console.log(reply.choices[0]?.message.content);
 * ```
 */
export class FreeTheAI {
  /** The cleaned API key in use. */
  readonly apiKey: string;
  readonly baseURL: string;
  readonly chat: Chat;
  readonly models: Models;
  readonly tasks: Tasks;
  readonly videos: Videos;
  readonly images: Images;
  private readonly transport: Transport;

  constructor(options: FreeTheAIOptions = {}) {
    const rawKey = options.apiKey ?? readEnv("FREETHEAI_API_KEY");
    if (!rawKey) {
      throw new FreeTheAIError(
        "No API key. Pass apiKey or set FREETHEAI_API_KEY (create a key at https://freetheai.org/dashboard/api-keys).",
      );
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new FreeTheAIError("This runtime has no fetch. Use Node 18 or newer, or pass a fetch option.");
    }
    this.apiKey = cleanKey(rawKey);
    this.baseURL = (options.baseURL ?? readEnv("FREETHEAI_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.transport = new Transport({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      maxRetries: options.maxRetries ?? 3,
      fallbackModels: options.fallbackModels ?? [],
      maxConcurrency: options.maxConcurrency ?? null,
      streamTransport: options.streamTransport ?? true,
      timeoutMs: options.timeout ?? DEFAULT_TIMEOUT_MS,
      defaultHeaders: options.defaultHeaders ?? {},
      // Wrapped so the call is not made as a method of the config object (browsers reject that).
      fetch: (input, init) => fetchImpl(input, init),
    });
    this.chat = new Chat(this.transport);
    this.models = new Models(this.transport);
    this.tasks = new Tasks(this.transport);
    this.videos = new Videos(this.transport);
    this.images = new Images(this.transport);
  }

  /** Searches the web; returns `results` with title, url, and text. */
  search(params: SearchParams): Promise<WebSearchResponse> {
    return searchWeb(this.transport, params);
  }

  /** Answers a question from current web sources; returns `answer` and `sources`. */
  answer(params: SearchParams): Promise<WebAnswerResponse> {
    return answerWeb(this.transport, params);
  }
}
