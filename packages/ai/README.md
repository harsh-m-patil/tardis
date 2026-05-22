# @tardis/ai

Provider-agnostic AI SDK with a buffered `complete()` API.

## Install (workspace)

```json
{
  "dependencies": {
    "@tardis/ai": "workspace:*",
    "openai": "^6"
  }
}
```

`openai` is a peer dependency of `@tardis/ai`.

## Public API

- `createProviderRegistry(initialProviders?)`
- `createAiSdk(initialProviders?)`
- `createOpenAICompatibleAdapter(options)`
- `type ProviderAdapter`

## Provider adapter contract

```ts
type InferenceTelemetryHooks = {
  onRawRequest?: (payload: unknown) => void;
  onRawResponse?: (payload: unknown) => void;
};

type ProviderAdapter = {
  name: string;
  defaultModel: string;
  complete: (
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    options: { model: string; temperature?: number; maxTokens?: number },
    telemetry?: InferenceTelemetryHooks,
  ) => Promise<string>;
  stream?: (
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    options: { model: string; temperature?: number; maxTokens?: number },
    telemetry?: InferenceTelemetryHooks,
  ) => AsyncIterable<StreamEvent>;
};
```

## Quick start (custom adapter)

```ts
import { createAiSdk, type ProviderAdapter } from "@tardis/ai";

const testAdapter: ProviderAdapter = {
  name: "test",
  defaultModel: "test-model",
  complete: async () => "hello from test adapter",
};

const sdk = createAiSdk([testAdapter]);

const output = await sdk.complete([{ role: "user", content: "Hi" }], {
  provider: "test",
});
```

## OpenAI-compatible adapter

```ts
import { createAiSdk, createOpenAICompatibleAdapter } from "@tardis/ai";

const openai = createOpenAICompatibleAdapter({
  name: "openai",
  defaultModel: "gpt-4o-mini",
  // optional overrides:
  // apiKey: "...",
  // apiKeyEnvVar: "OPENAI_API_KEY",
  // baseUrl: "https://api.openai.com",
  // defaultHeaders: { ... }
});

const sdk = createAiSdk([openai]);

const output = await sdk.complete([{ role: "user", content: "Summarize this" }], {
  provider: "openai",
  model: "gpt-4o-mini",
  temperature: 0.2,
  maxTokens: 256,
});
```

## OpenRouter example

```ts
const openrouter = createOpenAICompatibleAdapter({
  name: "openrouter",
  defaultModel: "openai/gpt-4o",
  apiKeyEnvVar: "OPENROUTER_API_KEY",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://your-site.example",
    "X-OpenRouter-Title": "Your App",
  },
});
```

## Notes

- `complete()` is buffered (non-streaming).
- `stream()` normalizes canonical lifecycle events even when providers omit some of them.
- `onRawRequest` / `onRawResponse` hooks let callers capture provider-boundary payloads for debugging.
- OpenAI adapter uses the official `openai` SDK (Chat Completions API).
- If `baseUrl` already ends with `/v1` (e.g. OpenRouter), SDK will not append another `/v1`.
- Missing provider registration or API key throws explicit errors.
