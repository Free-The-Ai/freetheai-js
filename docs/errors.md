---
description: Every error class in the FreeTheAI JavaScript SDK, when it is thrown, and what to do about it.
---

# Errors

All errors extend `FreeTheAIError`. API errors (`APIStatusError` and its subclasses) carry `statusCode`, `apiMessage`, `code`, `errorId`, and `body`.

```ts
import { CheckinRequiredError, DailyLimitError, FreeTheAIError } from "freetheai";

try {
  await client.chat.completions.create({ model: "fta/zai/glm-5.3", messages });
} catch (error) {
  if (error instanceof CheckinRequiredError) {
    console.log("Do the daily check-in:", error.checkinUrl);
  } else if (error instanceof DailyLimitError) {
    console.log("Free requests are used up until", error.resetsAt);
  } else if (error instanceof FreeTheAIError) {
    console.log("Failed:", error.message);
  } else {
    throw error;
  }
}
```

| Error | Status | When | What to do |
| --- | --- | --- | --- |
| `IncompleteKeyError` | 401 | The key is only part of a key | Copy the whole key, or create a new one |
| `AuthenticationError` | 401 | The key is wrong or revoked | Check the key on the [API keys page](https://freetheai.org/dashboard/api-keys) |
| `CheckinRequiredError` | 403 | Free models need today's check-in | Visit `error.checkinUrl` |
| `EmailNotVerifiedError` | 403 | The account's email isn't confirmed | Confirm it on the website |
| `PermissionDeniedError` | 403 | The key's scope or IP list doesn't allow this | Check the key's settings |
| `ModelNotFoundError` | 404 | No model has this ID | See `error.suggestions` |
| `NotFoundError` | 404 | Unknown task or route | |
| `BadRequestError` | 400 | The request is invalid | Read `error.apiMessage` |
| `ContentFilterError` | 400 | The model's content filter refused | Rephrase or use another model |
| `ImagesNotSupportedError` | 400 | The model reads text only | Remove images or pick another model |
| `RequestTooLargeError` | 413 | The request is over the size limit | Shorten the chat or drop images |
| `ConcurrencyLimitError` | 429 | Too many replies running (only after the client's own queueing gives up) | Wait for running replies |
| `DailyLimitError` | 429 | Today's free requests are used | Wait until `error.resetsAt` |
| `ProviderBudgetError` | 429 | This model's daily token budget is used | Use another model |
| `RateLimitError` | 429 | Too many requests | Slow down |
| `ModelBusyError` | 503 | Every route for the model is busy | Retry later or add fallback models |
| `InternalServerError` | 5xx | The service is temporarily unavailable | Retry later |
| `StreamInterruptedError` | | A stream stopped early | `error.partial` has the text so far |
| `TaskFailedError` | | An image or video task ended without output | Read `error.message` |
| `APIConnectionError` | | No answer (network or timeout) | Check your connection |

Include `error.errorId` when you ask for help.
