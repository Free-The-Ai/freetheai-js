/**
 * Errors raised by the client, and how each API answer maps onto them.
 *
 * The API's error bodies are stable, so the client recognises the common cases
 * (daily check-in, daily limit, a busy model, a content filter, ...) and throws a
 * specific class you can catch. Every API error carries the `errorId` to quote
 * when you ask for support.
 */

export const CHECKIN_URL = "https://freetheai.org/checkin";
export const KEYS_URL = "https://freetheai.org/dashboard/api-keys";
export const PLAN_URL = "https://freetheai.org/dashboard/plan";

/** Base class for every error this package throws. */
export class FreeTheAIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request never got an answer (network error or timeout). */
export class APIConnectionError extends FreeTheAIError {}

/**
 * A streamed reply stopped before the model said it was finished.
 * `partial` holds the text that arrived before the cut.
 */
export class StreamInterruptedError extends FreeTheAIError {
  readonly errorId?: string;
  partial: string;

  constructor(message: string, options: { errorId?: string; partial?: string } = {}) {
    super(options.errorId ? `${message} (error id ${options.errorId})` : message);
    this.errorId = options.errorId;
    this.partial = options.partial ?? "";
  }
}

/** An image or video task ended without output. */
export class TaskFailedError extends FreeTheAIError {
  readonly code?: string;
  readonly errorId?: string;
  readonly task?: unknown;

  constructor(message: string, options: { code?: string; errorId?: string; task?: unknown } = {}) {
    super(options.errorId ? `${message} (error id ${options.errorId})` : message);
    this.code = options.code;
    this.errorId = options.errorId;
    this.task = options.task;
  }
}

export interface APIStatusErrorInit {
  statusCode: number;
  code?: string;
  errorId?: string;
  body?: unknown;
  /** Seconds from the Retry-After header, when the API sent one. */
  retryAfter?: number;
}

/** The API answered with an error status. */
export class APIStatusError extends FreeTheAIError {
  readonly statusCode: number;
  /** The message as the API wrote it, without the status prefix. */
  readonly apiMessage: string;
  readonly code?: string;
  readonly errorId?: string;
  readonly body?: unknown;
  /** Seconds to wait before retrying, from Retry-After. */
  readonly retryAfter?: number;

  constructor(message: string, init: APIStatusErrorInit) {
    let text = `${init.statusCode}: ${message}`;
    if (init.errorId && !message.includes(init.errorId)) {
      text += ` (error id ${init.errorId})`;
    }
    super(text);
    this.apiMessage = message;
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.errorId = init.errorId;
    this.body = init.body;
    this.retryAfter = init.retryAfter;
  }
}

/** 400: the request was invalid. */
export class BadRequestError extends APIStatusError {}

/** 400: the model's content filter refused the request or its reply. Rephrasing or another model usually works. */
export class ContentFilterError extends BadRequestError {}

/** 400: the model reads text only; remove images or pick another model. */
export class ImagesNotSupportedError extends BadRequestError {}

/** 413: the request body is over the size limit (shorten the chat or drop images). */
export class RequestTooLargeError extends APIStatusError {}

/** 401: the API key is missing, wrong, or revoked. */
export class AuthenticationError extends APIStatusError {}

/** The key is only part of a key (a copied prefix, or cut off). Keys are shown once; create a new one. */
export class IncompleteKeyError extends AuthenticationError {}

/** 403: this key may not do this. */
export class PermissionDeniedError extends APIStatusError {}

/** 403: free models need the daily check-in on the website first. */
export class CheckinRequiredError extends PermissionDeniedError {
  readonly checkinUrl = CHECKIN_URL;
}

/** 403: confirm the account's email address before using the API. */
export class EmailNotVerifiedError extends PermissionDeniedError {}

/** 404: unknown task or route. */
export class NotFoundError extends APIStatusError {}

/** 404: no model has this ID. `suggestions` lists close model IDs. */
export class ModelNotFoundError extends NotFoundError {
  suggestions: string[] = [];
}

/** 429: too many requests. */
export class RateLimitError extends APIStatusError {}

/** 429: the account already has as many replies running as its plan allows. */
export class ConcurrencyLimitError extends RateLimitError {}

/** 429: today's free requests are used up. `resetsAt` is the next 00:00 UTC. */
export class DailyLimitError extends RateLimitError {
  readonly planUrl = PLAN_URL;

  get resetsAt(): Date {
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
    return next;
  }
}

/** 429: today's token budget for this model's provider is used up. Models from other providers still work. */
export class ProviderBudgetError extends RateLimitError {}

/** 5xx: the service or model is temporarily unavailable. */
export class InternalServerError extends APIStatusError {}

/** 503: every route for this model is busy; retry later or use another model. */
export class ModelBusyError extends InternalServerError {}

function secondsFrom(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseFloat(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
}

type Ctor = new (message: string, init: APIStatusErrorInit) => APIStatusError;

function classify(status: number, code: string | undefined, text: string): Ctor {
  if (status === 400) {
    if (code === "content_filter" || text.startsWith("content filtered")) return ContentFilterError;
    if (text.includes("accepts text only")) return ImagesNotSupportedError;
    return BadRequestError;
  }
  if (status === 401) {
    return text.includes("not a complete freetheai api key") ? IncompleteKeyError : AuthenticationError;
  }
  if (status === 403) {
    if (text.includes("daily check-in")) return CheckinRequiredError;
    if (text.includes("confirm your email")) return EmailNotVerifiedError;
    return PermissionDeniedError;
  }
  if (status === 404) {
    const missing =
      code === "model_not_found" || text.includes("was not found") || text.includes("model not found");
    return missing ? ModelNotFoundError : NotFoundError;
  }
  if (status === 413) return RequestTooLargeError;
  if (status === 429) {
    if (text.includes("daily free request limit")) return DailyLimitError;
    if (text.includes("token budget")) return ProviderBudgetError;
    if (text.includes("concurrency limit")) return ConcurrencyLimitError;
    return RateLimitError;
  }
  if (status >= 500) {
    return text.includes("busy") || text.includes("at capacity") ? ModelBusyError : InternalServerError;
  }
  return APIStatusError;
}

/**
 * Builds the matching error from a status code, a decoded JSON body (or undefined
 * when the body was not JSON), the raw text, and the response headers.
 */
export function errorFor(
  status: number,
  body: unknown,
  fallbackText: string,
  headers: { get(name: string): string | null } | undefined,
): APIStatusError {
  let message = "";
  let code: string | undefined;
  let errorId: string | undefined;

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const detail = record.error ?? record;
    if (detail && typeof detail === "object") {
      const info = detail as Record<string, unknown>;
      message = typeof info.message === "string" ? info.message : "";
      const rawCode = info.code ?? info.type;
      code = typeof rawCode === "string" ? rawCode : undefined;
      errorId = typeof info.error_id === "string" ? info.error_id : undefined;
    } else if (typeof detail === "string") {
      message = detail;
    }
  }

  if (!message) {
    // Not the API's JSON: usually an edge page (Cloudflare 52x) during a restart.
    message = body != null ? "request failed" : fallbackText.trim().slice(0, 200) || "request failed";
    if (status >= 500 || fallbackText.toLowerCase().includes("<html")) {
      message = "the service is temporarily unreachable";
    }
  }

  errorId = errorId ?? headers?.get("x-error-id") ?? undefined;
  const Cls = classify(status, code, message.toLowerCase());
  return new Cls(message, {
    statusCode: status,
    code,
    errorId,
    body,
    retryAfter: secondsFrom(headers?.get("retry-after") ?? null),
  });
}
