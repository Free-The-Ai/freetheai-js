import { FreeTheAI, type FreeTheAIOptions } from "../src/index.js";

export const KEY = `ftai_${"ab12".repeat(12)}`;

export interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

export type Handler = (request: Captured) => Response | Promise<Response>;

/** A fetch stand-in that records every call and answers with the handler. */
export function mockFetch(handler: Handler) {
  const calls: Captured[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const captured: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(captured);
    return handler(captured);
  };
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

export function makeClient(handler: Handler, options: Omit<FreeTheAIOptions, "fetch" | "apiKey"> = {}) {
  const mock = mockFetch(handler);
  const client = new FreeTheAI({ apiKey: KEY, fetch: mock.fetch, ...options });
  return { client, calls: mock.calls };
}

/** A server-sent events response; each event is JSON-encoded. */
export function sse(events: unknown[], done = true): Response {
  const body =
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function chunk(text?: string, finish?: string, delta: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = { ...delta };
  if (text !== undefined) payload.content = text;
  return {
    id: "chatcmpl-1",
    model: "m",
    choices: [{ index: 0, delta: payload, finish_reason: finish ?? null }],
  };
}

export function reply(text = "hi"): Response {
  return sse([chunk(text), chunk(undefined, "stop"), { choices: [], usage: { total_tokens: 3 } }]);
}

export function errorResponse(
  status: number,
  message: string,
  options: { code?: string; headers?: Record<string, string> } = {},
): Response {
  const body = { error: { message, code: options.code, error_id: "freetheai-abc" } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function textResponse(status: number, text: string): Response {
  return new Response(text, { status, headers: { "content-type": "text/html" } });
}

/** The concurrency gate of a client, for assertions about its learned limit. */
export function gateOf(client: FreeTheAI) {
  return (client as unknown as { transport: { gate: import("../src/resilience.js").ConcurrencyGate } })
    .transport.gate;
}
