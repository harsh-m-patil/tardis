import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  continueConversation,
  createConversation,
  createDb,
  getInferenceRequestInspection,
  migrate,
  type InferenceRuntime,
} from "./index";

describe("DB telemetry persistence", () => {
  let directory: string;
  let databaseUrl: string;
  let db: ReturnType<typeof createDb>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tardis-db-test-"));
    databaseUrl = `file:${join(directory, "test.db")}`;
    db = createDb(databaseUrl);
    await migrate(db);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("persists safe previews by default without raw payloads", async () => {
    const conversation = await createConversation(db);
    const runtime: InferenceRuntime = {
      provider: "openrouter",
      model: "openai/gpt-4o",
      async *stream() {
        yield { type: "response_start" } as const;
        yield { type: "text_delta", text: "reply ".repeat(50).trim() } as const;
        yield { type: "usage", usage: {} } as const;
        yield { type: "request_end" } as const;
      },
    };

    const result = await continueConversation(db, conversation?.id ?? "", "secret ".repeat(50).trim(), runtime);
    const inspection = await getInferenceRequestInspection(db, result?.inferenceRequest?.id ?? "");

    expect(inspection?.inferenceRequest.inputPreview).toHaveLength(200);
    expect(inspection?.inferenceRequest.outputPreview).toHaveLength(200);
    expect(inspection?.inferenceRequest.rawRequestJson).toBeNull();
    expect(inspection?.inferenceRequest.rawResponseJson).toBeNull();
  });

  it("applies redaction before persisting previews", async () => {
    const conversation = await createConversation(db);
    const runtime: InferenceRuntime = {
      provider: "openrouter",
      model: "openai/gpt-4o",
      async *stream() {
        yield { type: "response_start" } as const;
        yield { type: "text_delta", text: "assistant secret response" } as const;
        yield { type: "usage", usage: {} } as const;
        yield { type: "request_end" } as const;
      },
    };

    const result = await continueConversation(
      db,
      conversation?.id ?? "",
      "user secret prompt",
      runtime,
      {
        telemetry: {
          preview: {
            redact: (value) => value.replaceAll("secret", "[REDACTED]"),
          },
        },
      },
    );
    const inspection = await getInferenceRequestInspection(db, result?.inferenceRequest?.id ?? "");

    expect(inspection?.inferenceRequest.inputPreview).toBe("user [REDACTED] prompt");
    expect(inspection?.inferenceRequest.outputPreview).toBe("assistant [REDACTED] response");
  });

  it("persists raw payloads only when explicitly enabled", async () => {
    const conversation = await createConversation(db);
    const runtime: InferenceRuntime = {
      provider: "openrouter",
      model: "openai/gpt-4o",
      async *stream(messages, telemetry) {
        telemetry?.onRawRequest?.({ providerBody: { messages, options: { model: "openai/gpt-4o" } } });
        yield { type: "response_start" } as const;
        telemetry?.onRawResponse?.({ providerChunk: { id: "chunk-1", delta: "raw " } });
        yield { type: "text_delta", text: "raw " } as const;
        telemetry?.onRawResponse?.({ providerChunk: { id: "chunk-2", delta: "capture response" } });
        yield { type: "text_delta", text: "capture response" } as const;
        yield { type: "usage", usage: { totalTokens: 7 } } as const;
        yield { type: "request_end" } as const;
      },
    };

    const result = await continueConversation(
      db,
      conversation?.id ?? "",
      "raw capture prompt",
      runtime,
      {
        telemetry: {
          captureRawPayloads: true,
        },
      },
    );
    const inspection = await getInferenceRequestInspection(db, result?.inferenceRequest?.id ?? "");

    expect(inspection?.inferenceRequest.rawRequestJson).toEqual(expect.any(String));
    expect(inspection?.inferenceRequest.rawResponseJson).toEqual(expect.any(String));
    expect(JSON.parse(inspection?.inferenceRequest.rawRequestJson ?? "{}")).toMatchObject({
      providerBody: {
        messages: [{ role: "user", content: "raw capture prompt" }],
        options: { model: "openai/gpt-4o" },
      },
    });
    expect(JSON.parse(inspection?.inferenceRequest.rawResponseJson ?? "{}")).toMatchObject({
      chunks: [
        { providerChunk: { id: "chunk-1", delta: "raw " } },
        { providerChunk: { id: "chunk-2", delta: "capture response" } },
      ],
    });
  });

  it("falls back to runtime-derived raw payloads when provider hooks do not emit them", async () => {
    const conversation = await createConversation(db);
    const runtime: InferenceRuntime = {
      provider: "openrouter",
      model: "openai/gpt-4o",
      async *stream() {
        yield { type: "response_start" } as const;
        yield { type: "text_delta", text: "fallback response" } as const;
        yield { type: "usage", usage: { totalTokens: 3 } } as const;
        yield { type: "request_end" } as const;
      },
    };

    const result = await continueConversation(
      db,
      conversation?.id ?? "",
      "fallback prompt",
      runtime,
      {
        telemetry: {
          captureRawPayloads: true,
        },
      },
    );
    const inspection = await getInferenceRequestInspection(db, result?.inferenceRequest?.id ?? "");

    expect(JSON.parse(inspection?.inferenceRequest.rawRequestJson ?? "{}")).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "fallback prompt" }],
    });
    expect(JSON.parse(inspection?.inferenceRequest.rawResponseJson ?? "{}")).toMatchObject({
      content: "fallback response",
      usage: { totalTokens: 3 },
    });
  });

  it("includes parsed events and summary in inspection results", async () => {
    const conversation = await createConversation(db);
    const runtime: InferenceRuntime = {
      provider: "openrouter",
      model: "openai/gpt-4o",
      async *stream() {
        yield { type: "response_start" } as const;
        yield { type: "text_delta", text: "hello" } as const;
        yield { type: "usage", usage: { totalTokens: 5 } } as const;
        yield { type: "request_end" } as const;
      },
    };

    const result = await continueConversation(db, conversation?.id ?? "", "inspect me", runtime);
    const inspection = await getInferenceRequestInspection(db, result?.inferenceRequest?.id ?? "");

    expect(inspection?.events[0]?.payload).toBeNull();
    expect(inspection?.events[2]?.payload).toEqual({ totalTokens: 5 });
    expect(inspection?.summary).toMatchObject({
      eventCount: 4,
      usage: { totalTokens: 5 },
      firstTokenLatencyMs: expect.any(Number),
      totalDurationMs: expect.any(Number),
    });
  });
});
