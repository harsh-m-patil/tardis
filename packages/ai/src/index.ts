import OpenAI from "openai";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type InferenceTelemetryHooks = {
  onRawRequest?: (payload: unknown) => void;
  onRawResponse?: (payload: unknown) => void;
};

export type CompleteOptions = {
  provider: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
} & InferenceTelemetryHooks;

export type ProviderCompleteOptions = {
  model: string;
  temperature?: number;
  maxTokens?: number;
};

export type InferenceUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type StreamEvent =
  | { type: "response_start" }
  | { type: "first_token" }
  | { type: "text_delta"; text: string }
  | { type: "usage"; usage: InferenceUsage }
  | { type: "request_end" };

export type ProviderAdapter = {
  name: string;
  defaultModel: string;
  complete: (
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    telemetry?: InferenceTelemetryHooks,
  ) => Promise<string>;
  stream?: (
    messages: ChatMessage[],
    options: ProviderCompleteOptions,
    telemetry?: InferenceTelemetryHooks,
  ) => AsyncIterable<StreamEvent>;
};

export type ProviderRegistry = {
  register: (provider: ProviderAdapter) => void;
  resolve: (name: string) => ProviderAdapter | undefined;
};

export type AiSdk = {
  registerProvider: (provider: ProviderAdapter) => void;
  complete: (messages: ChatMessage[], options: CompleteOptions) => Promise<string>;
  stream: (messages: ChatMessage[], options: CompleteOptions) => AsyncIterable<StreamEvent>;
};

export function createProviderRegistry(initialProviders: ProviderAdapter[] = []): ProviderRegistry {
  const providers = new Map<string, ProviderAdapter>();

  for (const provider of initialProviders) {
    providers.set(provider.name, provider);
  }

  return {
    register(provider) {
      providers.set(provider.name, provider);
    },
    resolve(name) {
      return providers.get(name);
    },
  };
}

export function createAiSdk(initialProviders: ProviderAdapter[] = []): AiSdk {
  const registry = createProviderRegistry(initialProviders);

  function resolveProvider(options: CompleteOptions): ProviderAdapter {
    const provider = registry.resolve(options.provider);

    if (!provider) {
      throw new Error(`Provider '${options.provider}' is not registered`);
    }

    return provider;
  }

  function toProviderOptions(provider: ProviderAdapter, options: CompleteOptions): ProviderCompleteOptions {
    return {
      model: options.model ?? provider.defaultModel,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    };
  }

  return {
    registerProvider(provider) {
      registry.register(provider);
    },
    async complete(messages, options) {
      const provider = resolveProvider(options);

      return provider.complete(messages, toProviderOptions(provider, options), {
        onRawRequest: options.onRawRequest,
        onRawResponse: options.onRawResponse,
      });
    },
    async *stream(messages, options) {
      const provider = resolveProvider(options);
      const providerOptions = toProviderOptions(provider, options);

      if (!provider.stream) {
        console.warn(
          `[ai-sdk] Provider '${provider.name}' does not implement stream(); falling back to complete() (non-token streaming).`,
        );
        const content = await provider.complete(messages, providerOptions, {
          onRawRequest: options.onRawRequest,
          onRawResponse: options.onRawResponse,
        });
        yield { type: "response_start" } as const;
        if (content.length > 0) {
          yield { type: "first_token" } as const;
          yield { type: "text_delta", text: content } as const;
        }
        yield { type: "usage", usage: {} } as const;
        yield { type: "request_end" } as const;
        return;
      }

      let sawResponseStart = false;
      let sawFirstToken = false;
      let sawUsage = false;
      let sawRequestEnd = false;

      for await (const event of provider.stream(messages, providerOptions, {
        onRawRequest: options.onRawRequest,
        onRawResponse: options.onRawResponse,
      })) {
        if (event.type === "response_start") {
          sawResponseStart = true;
          yield event;
          continue;
        }

        if (!sawResponseStart) {
          sawResponseStart = true;
          yield { type: "response_start" } as const;
        }

        if (event.type === "first_token") {
          if (!sawFirstToken) {
            sawFirstToken = true;
            yield event;
          }
          continue;
        }

        if (event.type === "text_delta") {
          if (event.text.length > 0 && !sawFirstToken) {
            sawFirstToken = true;
            yield { type: "first_token" } as const;
          }
          yield event;
          continue;
        }

        if (event.type === "usage") {
          if (!sawUsage) {
            sawUsage = true;
            yield event;
          }
          continue;
        }

        if (event.type === "request_end") {
          if (!sawRequestEnd) {
            sawRequestEnd = true;
            yield event;
          }
        }
      }

      if (!sawResponseStart) {
        yield { type: "response_start" } as const;
      }
      if (!sawUsage) {
        yield { type: "usage", usage: {} } as const;
      }
      if (!sawRequestEnd) {
        yield { type: "request_end" } as const;
      }
    },
  };
}

export type OpenAICompatibleAdapterOptions = {
  name: string;
  defaultModel: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  fetchFn?: typeof fetch;
};

function toOpenAiSdkBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function createOpenAICompatibleAdapter(options: OpenAICompatibleAdapterOptions): ProviderAdapter {
  const baseUrl = options.baseUrl ?? "https://api.openai.com";

  return {
    name: options.name,
    defaultModel: options.defaultModel,
    async complete(messages, config, telemetry) {
      const apiKey = options.apiKey ?? process.env[options.apiKeyEnvVar ?? "OPENAI_API_KEY"];

      if (!apiKey) {
        throw new Error(`Missing API key for provider '${options.name}'`);
      }

      const client = new OpenAI({
        apiKey,
        baseURL: toOpenAiSdkBaseUrl(baseUrl),
        defaultHeaders: options.defaultHeaders,
        fetch: options.fetchFn,
      });

      const requestBody = {
        model: config.model,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      };
      telemetry?.onRawRequest?.(requestBody);
      const completion = await client.chat.completions.create(requestBody);

      const content = completion.choices?.[0]?.message?.content;

      if (typeof content !== "string") {
        throw new Error("OpenAI-compatible response missing assistant content");
      }

      telemetry?.onRawResponse?.(completion);
      return content;
    },
    async *stream(messages, config, telemetry) {
      const apiKey = options.apiKey ?? process.env[options.apiKeyEnvVar ?? "OPENAI_API_KEY"];

      if (!apiKey) {
        throw new Error(`Missing API key for provider '${options.name}'`);
      }

      const client = new OpenAI({
        apiKey,
        baseURL: toOpenAiSdkBaseUrl(baseUrl),
        defaultHeaders: options.defaultHeaders,
        fetch: options.fetchFn,
      });

      yield { type: "response_start" } as const;

      let sawFirstToken = false;
      let usage: InferenceUsage | undefined;

      const requestBody = {
        model: config.model,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      };
      telemetry?.onRawRequest?.(requestBody);
      const stream = (await client.chat.completions.create(requestBody)) as AsyncIterable<
        OpenAI.Chat.Completions.ChatCompletionChunk
      >;

      for await (const chunk of stream) {
        telemetry?.onRawResponse?.(chunk);
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? undefined,
            outputTokens: chunk.usage.completion_tokens ?? undefined,
            totalTokens: chunk.usage.total_tokens ?? undefined,
          };
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          if (!sawFirstToken) {
            sawFirstToken = true;
            yield { type: "first_token" } as const;
          }
          yield { type: "text_delta", text: delta } as const;
        }
      }

      yield { type: "usage", usage: usage ?? {} } as const;
      yield { type: "request_end" } as const;
    },
  };
}
