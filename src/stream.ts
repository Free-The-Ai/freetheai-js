/** Server-sent events parsing for streamed chat completions. */

import { StreamInterruptedError } from "./errors.js";
import type { Json } from "./resilience.js";

/**
 * Yields each JSON event of an SSE body until `[DONE]`.
 * Comment lines (keepalives), event names, and ids are ignored.
 * Cancels the underlying body when the consumer stops early.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Json, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let data: string[] = [];

  const flush = (): Json | "done" | undefined => {
    if (data.length === 0) return undefined;
    const text = data.join("\n");
    data = [];
    if (text.trim() === "[DONE]") return "done";
    return decode(text);
  };

  const line = (raw: string): Json | "done" | undefined => {
    const value = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (value === "") return flush();
    if (value.startsWith("data:")) {
      data.push(value.slice(5).replace(/^ /, ""));
    }
    return undefined;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const raw of lines) {
        const event = line(raw);
        if (event === "done") return;
        if (event !== undefined) yield event;
      }
    }
    pending += decoder.decode();
    if (pending) {
      const event = line(pending);
      if (event === "done") return;
      if (event !== undefined) yield event;
    }
    const last = flush();
    if (last === "done") return;
    if (last !== undefined) yield last;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Parses one event's data; an error event mid-stream becomes StreamInterruptedError. */
export function decode(text: string): Json {
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    throw new StreamInterruptedError("the reply stream sent a broken event");
  }
  if (event && typeof event === "object" && "error" in event && !("choices" in event)) {
    const detail = (event as Json).error;
    const info: Json = detail && typeof detail === "object" ? detail : { message: String(detail) };
    throw new StreamInterruptedError(String(info.message || "stream interrupted"), {
      errorId: typeof info.error_id === "string" ? info.error_id : undefined,
    });
  }
  return event as Json;
}
