import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  CheckinRequiredError,
  ContentFilterError,
  DailyLimitError,
  FreeTheAI,
  FreeTheAIError,
  IncompleteKeyError,
  InternalServerError,
  ModelBusyError,
  ModelNotFoundError,
  RateLimitError,
  StreamInterruptedError,
  TaskFailedError,
  version,
} from "../src/index.js";
import { sleep } from "../src/internal/sleep.js";
import {
  KEY,
  chunk,
  errorResponse,
  gateOf,
  jsonResponse,
  makeClient,
  reply,
  sse,
  textResponse,
} from "./helpers.js";

// Retry waits are replaced so the suite runs instantly; the waits are still checked.
vi.mock("../src/internal/sleep.js", () => ({ sleep: vi.fn(async () => undefined) }));

const sleepMock = vi.mocked(sleep);

beforeEach(() => {
  sleepMock.mockClear();
  vi.stubEnv("FREETHEAI_API_KEY", "");
  vi.stubEnv("FREETHEAI_BASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A stream body split into arbitrary network chunks. */
function splitStream(pieces: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

// Basics ---------------------------------------------------------------------------

describe("chat basics", () => {
  it("fetches a chat as a stream and assembles it", async () => {
    const { client, calls } = makeClient(() => reply("Hello"));
    const result = await client.chat.completions.create({
      model: "fta/zai/glm-5.3",
      messages: [{ role: "user", content: "yo" }],
      temperature: 0.5,
    });

    expect(result.object).toBe("chat.completion");
    expect(result.choices[0]?.message.content).toBe("Hello");
    expect(result.choices[0]?.finish_reason).toBe("stop");
    expect(result.usage).toEqual({ total_tokens: 3 });
    expect(result.model).toBe("m");

    const [call] = calls;
    expect(call?.url).toBe("https://api.freetheai.org/v1/chat/completions");
    expect(call?.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(call?.headers["User-Agent"]).toBe(`freetheai-js/${version}`);
    expect(call?.body).toEqual({
      model: "fta/zai/glm-5.3",
      messages: [{ role: "user", content: "yo" }],
      temperature: 0.5,
      stream: true,
    });
  });

  it("sends a plain request when the stream transport is off", async () => {
    const { client, calls } = makeClient(
      () => jsonResponse(200, { object: "chat.completion", choices: [{ message: { content: "plain" } }] }),
      { streamTransport: false },
    );
    const result = await client.chat.completions.create({ model: "m", messages: [] });
    expect(result.choices[0]?.message.content).toBe("plain");
    expect(calls[0]?.body).not.toHaveProperty("stream");
  });

  it("assembles tool calls, reasoning, and think tags", async () => {
    const { client } = makeClient(() =>
      sse([
        chunk(undefined, undefined, { reasoning_content: "plan " }),
        chunk(undefined, undefined, {
          tool_calls: [{ index: 0, id: "call_1", function: { name: "get_", arguments: '{"a"' } }],
        }),
        chunk(undefined, undefined, {
          tool_calls: [{ index: 0, function: { name: "weather", arguments: ": 1}" } }],
        }),
        chunk(undefined, "tool_calls"),
      ]),
    );
    const message = (await client.chat.completions.create({ model: "m", messages: [] })).choices[0]?.message;
    expect(message?.reasoning_content).toBe("plan ");
    expect(message?.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"a": 1}' } },
    ]);

    const { client: thinker } = makeClient(() =>
      sse([chunk("<think>hmm</think>\nAnswer"), chunk(undefined, "stop")]),
    );
    const thought = (await thinker.chat.completions.create({ model: "m", messages: [] })).choices[0]?.message;
    expect(thought).toEqual({ role: "assistant", content: "Answer", reasoning_content: "hmm" });
  });

  it("streams text and skips keepalive comments", async () => {
    const { client } = makeClient(
      () =>
        new Response(
          `: keepalive\n\ndata: ${JSON.stringify(chunk("Hel"))}\n\ndata: ${JSON.stringify(chunk("lo"))}\n\ndata: ${JSON.stringify(chunk(undefined, "stop"))}\n\ndata: [DONE]\n\n`,
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
    );
    const pieces = await collect(client.chat.completions.streamText({ model: "m", messages: [] }));
    expect(pieces.join("")).toBe("Hello");
  });

  it("handles events split across network chunks", async () => {
    const event = `data: ${JSON.stringify(chunk("split"))}\n\n`;
    const { client } = makeClient(() =>
      splitStream([
        event.slice(0, 9),
        event.slice(9, 30),
        event.slice(30),
        `data: ${JSON.stringify(chunk(undefined, "stop"))}\n\ndata: [DONE]\n\n`,
      ]),
    );
    const chunks = await collect(
      await client.chat.completions.create({ model: "m", messages: [], stream: true }),
    );
    expect(chunks.map((c) => c.choices[0]?.delta.content ?? "").join("")).toBe("split");
  });

  it("creates a stream of chunks and the last chunk carries usage", async () => {
    const { client } = makeClient(() => reply("ok"));
    const chunks = await collect(
      await client.chat.completions.create({ model: "m", messages: [], stream: true }),
    );
    expect(chunks.at(-1)?.usage).toEqual({ total_tokens: 3 });
  });
});

// Known API answers ----------------------------------------------------------------

describe("known API answers", () => {
  it("cleans the key and fails fast on partial keys", () => {
    expect(new FreeTheAI({ apiKey: `  "Bearer ${KEY}"\n` }).apiKey).toBe(KEY);
    expect(() => new FreeTheAI({ apiKey: "ftai_23dc791..." })).toThrow(IncompleteKeyError);
    expect(() => new FreeTheAI({ apiKey: "ftai_23dc791…" })).toThrow(IncompleteKeyError);
  });

  it.each([
    [
      "checkin",
      errorResponse(
        403,
        "Daily check-in required for free models. Visit https://freetheai.org/checkin to solve the captcha.",
      ),
      CheckinRequiredError,
    ],
    [
      "daily limit",
      errorResponse(
        429,
        "Daily free request limit reached. It resets at 00:00 UTC; see https://freetheai.org/dashboard/plan.",
      ),
      DailyLimitError,
    ],
    ["unauthorized", errorResponse(401, "unauthorized"), AuthenticationError],
  ])("does not retry final answers (%s)", async (_name, response, cls) => {
    const responses = [response];
    const { client, calls } = makeClient(() => responses[0] as Response);
    const failure = await client.chat.completions
      .create({ model: "m", messages: [] })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(cls);
    expect(calls).toHaveLength(1);
    expect((failure as { errorId?: string }).errorId).toBe("freetheai-abc");
    if (cls === DailyLimitError) {
      expect((failure as DailyLimitError).resetsAt.getUTCHours()).toBe(0);
      expect((failure as DailyLimitError).resetsAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("moves a busy model to the fallback at once", async () => {
    const models: string[] = [];
    const { client } = makeClient(
      (request) => {
        models.push(request.body.model);
        if (request.body.model === "fta/kimi/k3") {
          return errorResponse(
            503,
            "this model is busy right now; try again in a minute or pick another model.",
            {
              headers: { "retry-after": "30" },
            },
          );
        }
        return reply("from fallback");
      },
      { fallbackModels: ["fta/zai/glm-5.3"] },
    );
    const result = await client.chat.completions.create({ model: "fta/kimi/k3", messages: [] });
    expect(models).toEqual(["fta/kimi/k3", "fta/zai/glm-5.3"]);
    expect(result.choices[0]?.message.content).toBe("from fallback");
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("waits Retry-After on a busy model without a fallback", async () => {
    const responses = [
      errorResponse(503, "this model is busy right now", { headers: { "retry-after": "30" } }),
      reply(),
    ];
    const { client } = makeClient(() => responses.shift() as Response);
    await client.chat.completions.create({ model: "m", messages: [] });
    expect(sleepMock.mock.calls.map((call) => call[0])).toEqual([30_000]);
  });

  it("raises ModelBusyError when every try is busy", async () => {
    const { client } = makeClient(() => errorResponse(503, "this model is busy right now"), {
      maxRetries: 1,
      fallbackModels: ["b"],
    });
    await expect(client.chat.completions.create({ model: "a", messages: [] })).rejects.toBeInstanceOf(
      ModelBusyError,
    );
  });

  it("tries the next model after a content filter, and raises without one", async () => {
    const handler = (request: { body: { model: string } }) =>
      request.body.model === "fta/dog/gpt-5"
        ? errorResponse(400, "Content filtered: ...", { code: "content_filter" })
        : reply();
    const { client } = makeClient(handler as never);
    const result = await client.chat.completions.create({
      model: "fta/dog/gpt-5",
      messages: [],
      fallbackModels: ["fta/zai/glm-5.3"],
    });
    expect(result.choices[0]?.message.content).toBe("hi");

    const { client: strict } = makeClient(handler as never);
    await expect(
      strict.chat.completions.create({ model: "fta/dog/gpt-5", messages: [] }),
    ).rejects.toBeInstanceOf(ContentFilterError);
  });

  it("lowers the concurrency limit after a refusal and retries", async () => {
    const responses = [
      errorResponse(429, "concurrency limit reached: your account already has as many requests running"),
      reply(),
    ];
    const { client } = makeClient(() => responses.shift() as Response);
    const result = await client.chat.completions.create({ model: "m", messages: [] });
    expect(result.choices[0]?.message.content).toBe("hi");
    const gate = gateOf(client);
    expect(gate.learned).toBe(1);
    expect(gate.inFlight).toBe(0);
  });

  it("retries a cut-off stream when nothing was shown yet", async () => {
    const responses = [sse([chunk("half a sen")], false), reply("whole")];
    const { client } = makeClient(() => responses.shift() as Response);
    const result = await client.chat.completions.create({ model: "m", messages: [] });
    expect(result.choices[0]?.message.content).toBe("whole");
  });

  it("raises a cut-off user stream with the partial text", async () => {
    const { client } = makeClient(() => sse([chunk("half a "), chunk("sentence")])); // [DONE], no finish reason
    const stream = await client.chat.completions.create({ model: "m", messages: [], stream: true });
    const failure = await collect(stream).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StreamInterruptedError);
    expect((failure as StreamInterruptedError).partial).toBe("half a sentence");
    expect(gateOf(client).inFlight).toBe(0);
  });

  it("raises when the stream sends an error event mid-reply", async () => {
    const body = `data: ${JSON.stringify(chunk("so"))}\n\ndata: ${JSON.stringify({
      error: { message: "stream interrupted", error_id: "freetheai-9" },
    })}\n\n`;
    const { client } = makeClient(() => new Response(body, { status: 200 }));
    const stream = await client.chat.completions.create({ model: "m", messages: [], stream: true });
    const failure = (await collect(stream).catch((error: unknown) => error)) as StreamInterruptedError;
    expect(failure).toBeInstanceOf(StreamInterruptedError);
    expect(failure.errorId).toBe("freetheai-9");
    expect(failure.partial).toBe("so");
  });

  it("fixes a model ID that is missing only its fta/ prefix", async () => {
    const models: string[] = [];
    const { client } = makeClient((request) => {
      if (request.url.endsWith("/v1/models")) {
        return jsonResponse(200, { data: [{ id: "fta/zai/glm-5.3" }, { id: "fta/kimi/k3" }] });
      }
      models.push(request.body.model);
      if (request.body.model === "zai/glm-5.3") {
        return errorResponse(404, 'model "zai/glm-5.3" was not found.', { code: "model_not_found" });
      }
      return reply();
    });
    await client.chat.completions.create({ model: "zai/glm-5.3", messages: [] });
    expect(models).toEqual(["zai/glm-5.3", "fta/zai/glm-5.3"]);
  });

  it("lists close model IDs for an unknown model", async () => {
    const { client } = makeClient((request) => {
      if (request.url.endsWith("/v1/models")) {
        return jsonResponse(200, { data: [{ id: "fta/zai/glm-5.3" }, { id: "fta/zai/glm-5.3-flash" }] });
      }
      return errorResponse(404, 'model "fta/zai/glm-5.4" was not found.', { code: "model_not_found" });
    });
    const failure = (await client.chat.completions
      .create({ model: "fta/zai/glm-5.4", messages: [] })
      .catch((error: unknown) => error)) as ModelNotFoundError;
    expect(failure).toBeInstanceOf(ModelNotFoundError);
    expect(failure.suggestions).toContain("fta/zai/glm-5.3");
    expect(failure.message).toContain("Did you mean");
  });

  it("retries edge HTML errors and reports them as unreachable", async () => {
    const responses = [textResponse(502, "<html>Bad gateway</html>"), jsonResponse(200, { data: [] })];
    const { client } = makeClient(() => responses.shift() as Response);
    expect(await client.models.list()).toEqual([]);

    const { client: down } = makeClient(() => textResponse(530, "<html>origin down</html>"), {
      maxRetries: 0,
    });
    const failure = await down.models.list().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InternalServerError);
    expect((failure as Error).message).toContain("temporarily unreachable");
  });

  it("retries rate limits, then gives up", async () => {
    let calls = 0;
    const { client } = makeClient(
      () => {
        calls += 1;
        return errorResponse(429, "rate limit reached", { headers: { "retry-after": "0" } });
      },
      { maxRetries: 2 },
    );
    await expect(client.search({ query: "cats" })).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toBe(3);
  });

  it("reads the error id from the X-Error-ID header", async () => {
    const { client } = makeClient(
      () =>
        new Response(JSON.stringify({ error: { message: "upstream provider temporarily unavailable" } }), {
          status: 502,
          headers: { "content-type": "application/json", "x-error-id": "freetheai-h" },
        }),
      { maxRetries: 0 },
    );
    const failure = (await client
      .search({ query: "x" })
      .catch((error: unknown) => error)) as InternalServerError;
    expect(failure).toBeInstanceOf(InternalServerError);
    expect(failure.errorId).toBe("freetheai-h");
  });
});

// Search, tasks, config --------------------------------------------------------------

describe("search, tasks, and configuration", () => {
  it("sends search and answer bodies", async () => {
    const { client, calls } = makeClient(() => jsonResponse(200, { results: [], answer: "x" }));
    await client.search({ query: "go", num_results: 3 });
    await client.answer({ query: "why" });
    expect(calls.map((call) => [new URL(call.url).pathname, call.body])).toEqual([
      ["/v1/search", { query: "go", num_results: 3 }],
      ["/v1/answer", { query: "why" }],
    ]);
  });

  it("polls a task until it is done, then downloads its bytes", async () => {
    const states = ["queued", "in_progress", "completed"];
    const { client } = makeClient((request) => {
      if (request.url.endsWith("/content?index=0")) return new Response(new TextEncoder().encode("MP4"));
      return jsonResponse(200, { id: "task_1", status: states.shift() ?? "completed", model: "m" });
    });
    const task = await client.tasks.wait("task_1", { pollIntervalMs: 1 });
    expect(task.status).toBe("completed");
    expect(new TextDecoder().decode(await client.tasks.content("task_1"))).toBe("MP4");
  });

  it("raises TaskFailedError with the error id when a task fails", async () => {
    const { client } = makeClient(() =>
      jsonResponse(200, {
        id: "t",
        status: "failed",
        model: "m",
        error: { message: "refused", error_id: "e1" },
      }),
    );
    const failure = (await client.tasks.wait("t").catch((error: unknown) => error)) as TaskFailedError;
    expect(failure).toBeInstanceOf(TaskFailedError);
    expect(failure.errorId).toBe("e1");
  });

  it("reads the key from the environment when none is passed", () => {
    vi.stubEnv("FREETHEAI_API_KEY", KEY);
    vi.stubEnv("FREETHEAI_BASE_URL", "http://localhost:9/v1/");
    const client = new FreeTheAI();
    expect(client.apiKey).toBe(KEY);
    expect(client.baseURL).toBe("http://localhost:9/v1");
  });

  it("throws a FreeTheAIError when there is no key", () => {
    expect(() => new FreeTheAI()).toThrow(FreeTheAIError);
  });

  it("uses a fixed concurrency cap when maxConcurrency is set", async () => {
    const { client } = makeClient(() => reply(), { maxConcurrency: 2 });
    expect(gateOf(client).limit()).toBe(2);
    await client.chat.completions.create({ model: "m", messages: [] });
    expect(gateOf(client).inFlight).toBe(0);
  });

  it("builds image and video tasks", async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse(200, { id: "task_9", status: "queued", model: "m" }),
    );
    await client.images.generate({ model: "m", prompt: "a boat", n: 2 });
    await client.videos.create({ model: "m", prompt: "a wave", seconds: "4" });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/images/generations", "/v1/videos"]);
    expect(calls[0]?.body).toEqual({ model: "m", prompt: "a boat", n: 2 });
  });
});

// Async behaviour and parallel calls -------------------------------------------------

describe("parallel calls", () => {
  it("streams text through the fallback, then answers a second call", async () => {
    const { client } = makeClient(
      (request) => {
        if (request.url.endsWith("/v1/answer")) return jsonResponse(200, { answer: "ok" });
        if (request.body?.model === "busy") return errorResponse(503, "this model is busy right now");
        return reply("ab");
      },
      { fallbackModels: ["ok"] },
    );
    const pieces = await collect(client.chat.completions.streamText({ model: "busy", messages: [] }));
    expect(pieces).toEqual(["ab"]);
    const result = await client.chat.completions.create({ model: "busy", messages: [] });
    expect(result.choices[0]?.message.content).toBe("ab");
    expect((await client.answer({ query: "q" })).answer).toBe("ok");
    expect(gateOf(client).inFlight).toBe(0);
  });

  it("runs several calls at once without exceeding a learned limit", async () => {
    let active = 0;
    let peak = 0;
    const { client } = makeClient(
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return reply("x");
      },
      { maxConcurrency: 1 },
    );
    await Promise.all([1, 2, 3].map(() => client.chat.completions.create({ model: "m", messages: [] })));
    expect(peak).toBe(1);
  });
});
