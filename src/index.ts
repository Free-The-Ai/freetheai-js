/**
 * FreeTheAI: the official JavaScript and TypeScript client for the free,
 * OpenAI-compatible FreeTheAI API. Zero runtime dependencies.
 *
 * @packageDocumentation
 */

export { FreeTheAI, type FreeTheAIOptions } from "./client.js";
export {
  APIConnectionError,
  APIStatusError,
  AuthenticationError,
  BadRequestError,
  CheckinRequiredError,
  ConcurrencyLimitError,
  ContentFilterError,
  DailyLimitError,
  EmailNotVerifiedError,
  FreeTheAIError,
  ImagesNotSupportedError,
  IncompleteKeyError,
  InternalServerError,
  ModelBusyError,
  ModelNotFoundError,
  NotFoundError,
  PermissionDeniedError,
  ProviderBudgetError,
  RateLimitError,
  RequestTooLargeError,
  StreamInterruptedError,
  TaskFailedError,
} from "./errors.js";
export type {
  ChatChoice,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionChunkChoice,
  ChatCompletionCreateParams,
  ChatMessage,
  FunctionTool,
  ImageGenerateParams,
  ImagePart,
  MediaTask,
  MediaTaskOutput,
  Model,
  Role,
  SearchParams,
  TaskStatus,
  TaskWaitOptions,
  TextPart,
  ToolCall,
  Usage,
  UrlCitation,
  VideoCreateParams,
  WebAnswerResponse,
  WebSearchResponse,
  WebSearchResult,
} from "./types.js";
export { VERSION as version } from "./version.js";
