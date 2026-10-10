/**
 * Request and response types for the FreeTheAI API.
 *
 * Body fields keep the API's snake_case names (the same names the OpenAI
 * Chat Completions API uses), so existing payloads can be passed through as is.
 */

export type Role = "system" | "user" | "assistant" | "tool" | "developer";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export interface ChatMessage {
  role: Role;
  content?: string | Array<TextPart | ImagePart> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string;
  [extra: string]: unknown;
}

export interface FunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [extra: string]: unknown;
}

export interface UrlCitation {
  type: "url_citation";
  url_citation: { url: string; title?: string };
}

export interface ChatCompletionCreateParams {
  /** A model ID from `client.models.list()`, e.g. `fta/zai/glm-5.3`. */
  model: string;
  messages: ChatMessage[];
  /** Models tried in order after this one fails. Overrides the client's list for this call. */
  fallbackModels?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  seed?: number;
  tools?: FunctionTool[];
  tool_choice?: "none" | "auto" | "required" | { type: "function"; function: { name: string } };
  response_format?:
    | { type: "text" }
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: unknown };
  reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high";
  /** Send `{}` to let a model with built-in search look things up before it answers. */
  web_search_options?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage & { role: "assistant" };
  finish_reason: string | null;
  annotations?: UrlCitation[];
}

/** The reply of a non-streamed chat, assembled when the stream transport is on. */
export interface ChatCompletion {
  id?: string;
  object: "chat.completion";
  created?: number;
  model?: string;
  choices: ChatChoice[];
  usage?: Usage;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: Role;
    content?: string | null;
    reasoning_content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: "function";
      function?: { name?: string; arguments?: string };
    }>;
    annotations?: UrlCitation[];
  };
  finish_reason: string | null;
  annotations?: UrlCitation[];
}

/** One streamed chunk. The last chunk carries `usage`. */
export interface ChatCompletionChunk {
  id?: string;
  object?: "chat.completion.chunk";
  created?: number;
  model?: string;
  choices: ChatCompletionChunkChoice[];
  usage?: Usage;
}

export interface Model {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface WebSearchResult {
  title?: string;
  url?: string;
  text?: string;
  highlights?: string[];
  publishedDate?: string;
  score?: number;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  suggestions?: string[];
  daily_used?: number;
  daily_limit?: number;
}

export interface WebAnswerResponse {
  query: string;
  answer: string;
  sources: WebSearchResult[];
  daily_used?: number;
  daily_limit?: number;
}

export interface SearchParams {
  query: string;
  /** 1 to 25, default 10. */
  num_results?: number;
}

export type TaskStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | (string & {});

export interface MediaTaskOutput {
  /** The image, base64-encoded (default response format). */
  b64_json?: string;
  /** Download URL when the task asked for `response_format: "url"`. */
  url?: string;
}

export interface MediaTask {
  id: string;
  object?: string;
  kind?: "video" | "image";
  model: string;
  status: TaskStatus;
  created_at?: number;
  completed_at?: number;
  expires_at?: number;
  content_url?: string;
  /** Images, once completed. */
  data?: MediaTaskOutput[];
  error?: { code?: string; message?: string; error_id?: string } | null;
  [extra: string]: unknown;
}

export interface VideoCreateParams {
  model: string;
  prompt?: string;
  /** First frame: an https image URL or a base64 data URL. */
  input_reference?: string;
  /** Duration in seconds, as a string or number. */
  seconds?: string | number;
  /** Output size as WIDTHxHEIGHT, e.g. "720x1280". */
  size?: string;
  [extra: string]: unknown;
}

export interface ImageGenerateParams {
  model: string;
  prompt: string;
  /** How many images, 1 to 4 (default 1). */
  n?: number;
  /** Size as WIDTHxHEIGHT, e.g. "1024x1024". */
  size?: string;
  /** "b64_json" (default) or "url". */
  response_format?: "b64_json" | "url";
  /** Optional source image: an https URL or a base64 data URL. */
  image?: string;
  [extra: string]: unknown;
}

export interface TaskWaitOptions {
  /** Milliseconds between polls. Default 5000. */
  pollIntervalMs?: number;
  /** Give up after this many milliseconds. Default 1800000 (30 minutes). */
  timeoutMs?: number;
}
