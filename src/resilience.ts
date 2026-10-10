/**
 * Built-in handling for the FreeTheAI API's known behaviours.
 *
 * - Keys: stray spaces, quotes, and a pasted "Bearer " are removed; a key that is
 *   only part of a key fails at once instead of on every request.
 * - Concurrency: when the API says the account is at its limit, the client lowers
 *   its own limit to what the account allows and queues the rest.
 * - Busy models: retried after the server's Retry-After, or moved straight to the
 *   next model in `fallbackModels`.
 * - Long replies without streaming are fetched as a stream and assembled.
 * - Cut-off streams: a stream that ends without a finish reason is an error, never
 *   a silently short answer. When nothing was shown yet, it is retried.
 * - Unknown model IDs: the error lists close IDs from /v1/models, and an ID missing
 *   only its "fta/" prefix is fixed automatically.
 */

import {
  APIConnectionError,
  APIStatusError,
  ConcurrencyLimitError,
  ContentFilterError,
  ImagesNotSupportedError,
  IncompleteKeyError,
  InternalServerError,
  ModelBusyError,
  ModelNotFoundError,
  ProviderBudgetError,
  RateLimitError,
  StreamInterruptedError,
} from "./errors.js";

export const KEY_PATTERN = /^ftai_[0-9a-fA-F]{48}$/;
/** How long a lowered concurrency limit holds before the client tries more again. */
export const LIMIT_RELAX_MS = 600_000;
/** Retry-After from a busy model is capped so a call never hangs for minutes. */
export const MAX_BUSY_WAIT_MS = 30_000;
export const CONCURRENCY_RETRIES = 6;

/** Removes copy-paste debris and refuses a key that is only part of one. */
export function cleanKey(raw: string): string {
  let key = raw
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (key.toLowerCase().startsWith("bearer ")) {
    key = key.slice(7).trim();
  }
  if (key.startsWith("ftai_") && !KEY_PATTERN.test(key)) {
    throw new IncompleteKeyError(
      "This is not a complete FreeTheAI API key. A key starts with ftai_ and is 53 characters long; " +
        "it is shown only once, when you create it. Create a new key at " +
        "https://freetheai.org/dashboard/api-keys.",
      { statusCode: 401 },
    );
  }
  return key;
}

// Retry and fallback rules ---------------------------------------------------------

export type Action = "retry" | "fallback" | "raise";

export interface Decision {
  action: Action;
  /** Milliseconds to wait before the next try. */
  delayMs: number;
}

const RAISE_NOW: Decision = { action: "raise", delayMs: 0 };

/** What to do after `error` on the `attempt`-th try (counting from 0) of one model. */
export function decide(error: unknown, attempt: number, maxRetries: number, hasFallback: boolean): Decision {
  if (error instanceof ConcurrencyLimitError) {
    if (attempt < Math.max(maxRetries, CONCURRENCY_RETRIES)) {
      return { action: "retry", delayMs: backoffMs(attempt, 1, 10) };
    }
    return RAISE_NOW;
  }
  if (
    error instanceof ContentFilterError ||
    error instanceof ImagesNotSupportedError ||
    error instanceof ProviderBudgetError ||
    error instanceof ModelNotFoundError
  ) {
    return hasFallback ? { action: "fallback", delayMs: 0 } : RAISE_NOW;
  }
  if (error instanceof ModelBusyError) {
    if (hasFallback) return { action: "fallback", delayMs: 0 };
    if (attempt < maxRetries) {
      const wait = error.retryAfter !== undefined ? error.retryAfter * 1000 : backoffMs(attempt, 5, 30);
      return { action: "retry", delayMs: Math.min(wait, MAX_BUSY_WAIT_MS) };
    }
    return RAISE_NOW;
  }

  const retryable =
    error instanceof APIConnectionError ||
    error instanceof InternalServerError ||
    error instanceof StreamInterruptedError ||
    (error instanceof RateLimitError && error.constructor === RateLimitError) ||
    (error instanceof APIStatusError && (error.statusCode === 408 || error.statusCode === 409));
  if (retryable) {
    if (attempt < maxRetries) {
      const delay = error instanceof APIStatusError ? error.retryAfter : undefined;
      const delayMs = delay !== undefined ? Math.min(delay * 1000, MAX_BUSY_WAIT_MS) : backoffMs(attempt);
      return { action: "retry", delayMs };
    }
    return hasFallback ? { action: "fallback", delayMs: 0 } : RAISE_NOW;
  }
  return RAISE_NOW;
}

/** Exponential backoff with a little jitter, in milliseconds. */
export function backoffMs(attempt: number, baseSeconds = 0.5, capSeconds = 8): number {
  return Math.min(baseSeconds * 2 ** attempt, capSeconds) * 1000 + Math.random() * 250;
}

// Adaptive concurrency --------------------------------------------------------------

/**
 * Limits replies in flight to what the account allows.
 *
 * It starts open (or at `fixed`). After a concurrency refusal it lowers the limit to
 * the replies that were running alongside, and after LIMIT_RELAX_MS without another
 * refusal it opens again, so a plan upgrade is picked up without a restart.
 */
export class ConcurrencyGate {
  learned: number | null = null;
  inFlight = 0;
  private loweredAt = 0;
  private waiters: Array<() => void> = [];

  constructor(readonly fixed: number | null = null) {}

  limit(): number | null {
    if (this.learned !== null && Date.now() - this.loweredAt > LIMIT_RELAX_MS) {
      this.learned = null;
    }
    const limits = [this.fixed, this.learned].filter((value): value is number => !!value);
    return limits.length ? Math.min(...limits) : null;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const limit = this.limit();
      if (limit === null || this.inFlight < limit) break;
      await this.wait();
    }
    this.inFlight += 1;
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.wakeAll();
  }

  /** Called (while still holding a slot) after a concurrency refusal. */
  refused(): void {
    this.learned = Math.max(1, this.inFlight - 1);
    this.loweredAt = Date.now();
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((waiter) => waiter !== wake);
        resolve();
      };
      // Re-check at least once a second so a relaxed limit is noticed while waiting.
      const timer = setTimeout(wake, 1000);
      this.waiters.push(wake);
    });
  }

  private wakeAll(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const wake of pending) wake();
  }
}

// Streams -------------------------------------------------------------------------------

export type Json = Record<string, any>;

const THINK = /^\s*<(think|thinking)>([\s\S]*?)<\/\1>\s*/;

interface Slot {
  role: "assistant";
  content: string[];
  reasoning: string[];
  tools: Map<number, { id: string; type: "function"; function: { name: string; arguments: string } }>;
  finishReason: string | null;
  annotations: unknown[];
  hasAnnotations: boolean;
}

/** Builds one chat completion from streamed chunks. */
export class ChatAssembler {
  private head: Json = {};
  private choices = new Map<number, Slot>();
  private usage: Json | null = null;

  get finished(): boolean {
    if (this.choices.size === 0) return false;
    for (const slot of this.choices.values()) {
      if (!slot.finishReason) return false;
    }
    return true;
  }

  text(): string {
    let out = "";
    for (const slot of this.choices.values()) out += slot.content.join("");
    return out;
  }

  feed(chunk: Json): void {
    for (const key of ["id", "created", "model"]) {
      if (chunk[key] && !(key in this.head)) this.head[key] = chunk[key];
    }
    if (chunk.usage) this.usage = chunk.usage;
    for (const choice of (chunk.choices as Json[] | undefined) ?? []) {
      const index: number = choice.index ?? 0;
      let slot = this.choices.get(index);
      if (!slot) {
        slot = {
          role: "assistant",
          content: [],
          reasoning: [],
          tools: new Map(),
          finishReason: null,
          annotations: [],
          hasAnnotations: false,
        };
        this.choices.set(index, slot);
      }
      const delta: Json = choice.delta ?? {};
      if (delta.content) slot.content.push(delta.content);
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === "string" && reasoning) slot.reasoning.push(reasoning);
      for (const call of (delta.tool_calls as Json[] | undefined) ?? []) {
        const key: number = call.index ?? slot.tools.size;
        let tool = slot.tools.get(key);
        if (!tool) {
          tool = { id: "", type: "function", function: { name: "", arguments: "" } };
          slot.tools.set(key, tool);
        }
        tool.id = call.id || tool.id;
        const fn: Json = call.function ?? {};
        tool.function.name += fn.name ?? "";
        tool.function.arguments += fn.arguments ?? "";
      }
      if (choice.finish_reason) slot.finishReason = choice.finish_reason;
      const annotations = choice.annotations ?? delta.annotations;
      if (annotations) {
        slot.annotations.push(...annotations);
        slot.hasAnnotations = true;
      }
    }
  }

  /** The assembled chat.completion object. */
  result(): Json {
    const choices: Json[] = [];
    for (const index of [...this.choices.keys()].sort((a, b) => a - b)) {
      const slot = this.choices.get(index) as Slot;
      let content = slot.content.join("");
      let reasoning = slot.reasoning.join("");
      const match = THINK.exec(content);
      if (match) {
        // Some models put their thinking at the start of the reply.
        reasoning = reasoning || (match[2] ?? "").trim();
        content = content.slice(match[0].length);
      }
      const message: Json = { role: slot.role, content };
      if (reasoning) message.reasoning_content = reasoning;
      if (slot.tools.size) {
        message.tool_calls = [...slot.tools.keys()].sort((a, b) => a - b).map((key) => slot.tools.get(key));
      }
      if (slot.hasAnnotations) message.annotations = slot.annotations;
      choices.push({ index, message, finish_reason: slot.finishReason });
    }
    const result: Json = { object: "chat.completion", ...this.head, choices };
    if (this.usage) result.usage = this.usage;
    return result;
  }
}

export function interrupted(assembler: ChatAssembler, errorId?: string): StreamInterruptedError {
  return new StreamInterruptedError("the reply stream stopped before the model finished", {
    errorId,
    partial: assembler.text(),
  });
}

// Model IDs -----------------------------------------------------------------------------

/** Ratcliff/Obershelp similarity in [0, 1], like Python's difflib ratio(). */
export function similarity(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  return (2 * matchCount(a, 0, a.length, b, 0, b.length)) / total;
}

function matchCount(a: string, alo: number, ahi: number, b: string, blo: number, bhi: number): number {
  if (alo >= ahi || blo >= bhi) return 0;
  let bestSize = 0;
  let bestI = alo;
  let bestJ = blo;
  // Longest common substring inside the two windows (earliest in a, then in b).
  for (let i = alo; i < ahi; i++) {
    for (let j = blo; j < bhi; j++) {
      let k = 0;
      while (i + k < ahi && j + k < bhi && a[i + k] === b[j + k]) k++;
      if (k > bestSize) {
        bestSize = k;
        bestI = i;
        bestJ = j;
      }
    }
  }
  if (bestSize === 0) return 0;
  return (
    bestSize +
    matchCount(a, alo, bestI, b, blo, bestJ) +
    matchCount(a, bestI + bestSize, ahi, b, bestJ + bestSize, bhi)
  );
}

/** Close model IDs for an unknown one, best first (at most 5). */
export function suggestModels(model: string, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const exact = ids.filter((id) => id === `fta/${model}` || id.endsWith(`/${model}`));
  if (exact.length) return exact.slice(0, 5);

  const close = closeMatches(model, ids, 5);
  const tails = new Map<string, string>();
  for (const id of ids) tails.set(id.split("/").pop() ?? id, id);
  const tailModel = model.split("/").pop() ?? model;
  for (const tail of closeMatches(tailModel, [...tails.keys()], 5)) {
    const id = tails.get(tail) as string;
    if (!close.includes(id)) close.push(id);
  }
  return close.slice(0, 5);
}

/** difflib.get_close_matches: ratio >= cutoff, best first, ties broken by the string (descending). */
function closeMatches(word: string, options: readonly string[], n: number, cutoff = 0.6): string[] {
  return options
    .map((option) => ({ option, score: similarity(word, option) }))
    .filter((entry) => entry.score >= cutoff)
    .sort((x, y) => y.score - x.score || (x.option < y.option ? 1 : x.option > y.option ? -1 : 0))
    .slice(0, n)
    .map((entry) => entry.option);
}

/** The one ID the model clearly meant (only the "fta/" prefix missing), if any. */
export function fixable(model: string, suggestions: readonly string[]): string | null {
  if (model.startsWith("fta/") || model.startsWith("freetheai/")) return null;
  return suggestions.includes(`fta/${model}`) ? `fta/${model}` : null;
}
