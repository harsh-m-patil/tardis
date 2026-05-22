import { describe, expect, it } from "vitest";

import { createAiSdk, type ProviderAdapter, type StreamEvent } from "./index";

async function collectEvents(iterable: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe("AI SDK", () => {
  it("returns buffered text from a registered provider adapter", async () => {
    const provider: ProviderAdapter = {
      name: "test",
      defaultModel: "test-model",
      complete: async () => "hello from adapter",
    };
    const sdk = createAiSdk([provider]);

    const result = await sdk.complete([{ role: "user", content: "Hi" }], {
      provider: "test",
    });

    expect(result).toBe("hello from adapter");
  });

  it("throws when provider is not registered", async () => {
    const sdk = createAiSdk();

    await expect(
      sdk.complete([{ role: "user", content: "Hi" }], {
        provider: "missing",
      }),
    ).rejects.toThrow("is not registered");
  });

  it("streams via complete fallback when provider has no stream implementation", async () => {
    const sdk = createAiSdk([
      {
        name: "test",
        defaultModel: "test-model",
        complete: async () => "hello fallback",
      },
    ]);

    const events = await collectEvents(
      sdk.stream([{ role: "user", content: "Hi" }], {
        provider: "test",
      }),
    );

    expect(events).toEqual([
      { type: "response_start" },
      { type: "first_token" },
      { type: "text_delta", text: "hello fallback" },
      { type: "usage", usage: {} },
      { type: "request_end" },
    ]);
  });

  it("normalizes missing canonical stream events from providers", async () => {
    const sdk = createAiSdk([
      {
        name: "test",
        defaultModel: "test-model",
        complete: async () => "unused",
        async *stream() {
          yield { type: "text_delta", text: "hello " } as const;
          yield { type: "text_delta", text: "world" } as const;
        },
      },
    ]);

    const events = await collectEvents(
      sdk.stream([{ role: "user", content: "Hi" }], {
        provider: "test",
      }),
    );

    expect(events).toEqual([
      { type: "response_start" },
      { type: "first_token" },
      { type: "text_delta", text: "hello " },
      { type: "text_delta", text: "world" },
      { type: "usage", usage: {} },
      { type: "request_end" },
    ]);
  });

  it("emits raw request and response payloads from the provider boundary when hooks are provided", async () => {
    const rawRequests: unknown[] = [];
    const rawResponses: unknown[] = [];
    const sdk = createAiSdk([
      {
        name: "test",
        defaultModel: "test-model",
        complete: async () => "unused",
        async *stream(messages, options, telemetry) {
          telemetry?.onRawRequest?.({ providerBody: { messages, options } });
          yield { type: "response_start" } as const;
          telemetry?.onRawResponse?.({ providerChunk: { id: "chunk-1", delta: "hello" } });
          yield { type: "text_delta", text: "hello" } as const;
          yield { type: "usage", usage: { totalTokens: 5 } } as const;
          yield { type: "request_end" } as const;
        },
      },
    ]);

    const events = await collectEvents(
      sdk.stream([{ role: "user", content: "Hi" }], {
        provider: "test",
        onRawRequest: (payload) => {
          rawRequests.push(payload);
        },
        onRawResponse: (payload) => {
          rawResponses.push(payload);
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "response_start",
      "first_token",
      "text_delta",
      "usage",
      "request_end",
    ]);
    expect(rawRequests).toEqual([
      {
        providerBody: {
          messages: [{ role: "user", content: "Hi" }],
          options: { model: "test-model", temperature: undefined, maxTokens: undefined },
        },
      },
    ]);
    expect(rawResponses).toEqual([{ providerChunk: { id: "chunk-1", delta: "hello" } }]);
  });
});
