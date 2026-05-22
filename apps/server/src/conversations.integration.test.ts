import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAiSdk } from "@tardis/ai";
import { computeLatencyFromEvents, createDb, listInferenceEvents } from "@tardis/db";

import { createApp } from "./app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response) => res.json() as Promise<any>;

async function readNdjson(response: Response) {
  const events: Array<Record<string, unknown>> = [];
  const text = await response.text();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    events.push(JSON.parse(line) as Record<string, unknown>);
  }

  return events;
}

describe("Conversation API", () => {
  let directory: string;
  let app: Awaited<ReturnType<typeof createApp>>;

  const testSdk = createAiSdk([
    {
      name: "openrouter",
      defaultModel: "openai/gpt-4o",
      complete: async () => "I am a deterministic test response.",
    },
  ]);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tardis-server-test-"));
    const databaseUrl = `file:${join(directory, "test.db")}`;
    app = await createApp({ databaseUrl, aiSdk: testSdk });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("GET /conversations returns an empty list when no Conversation exists", async () => {
    const response = await app.request("/conversations");

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ conversations: [] });
  });

  it("POST /conversations creates a Conversation and returns it", async () => {
    const createResponse = await app.request("/conversations", {
      method: "POST",
    });

    expect(createResponse.status).toBe(201);
    const body = await json(createResponse);
    expect(body.conversation).toMatchObject({
      id: expect.any(String),
      status: "active",
    });
    expect(body.conversation.createdAt).toBeDefined();

    // Verify it shows up in the list
    const listResponse = await app.request("/conversations");
    const listBody = await json(listResponse);
    expect(listBody.conversations).toHaveLength(1);
    expect(listBody.conversations[0].id).toBe(body.conversation.id);
  });

  it("POST /conversations/:id/messages persists a Turn and returns the assistant reply", async () => {
    const createRes = await app.request("/conversations", { method: "POST" });
    const { conversation } = await json(createRes);

    const msgRes = await app.request(`/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });

    expect(msgRes.status).toBe(201);
    const body = await json(msgRes);
    expect(body.message).toMatchObject({
      id: expect.any(String),
      role: "assistant",
      content: expect.any(String),
    });
    expect(body.turn).toMatchObject({
      id: expect.any(String),
      status: "completed",
      committedAssistantMessageId: body.message.id,
    });
    expect(body.inferenceRequest).toMatchObject({
      id: expect.any(String),
      provider: expect.any(String),
      model: expect.any(String),
      status: "completed",
    });

    const listResponse = await app.request("/conversations");
    const { conversations } = await json(listResponse);
    expect(conversations[0].title).toBe("Hello");
  });

  it("POST /conversations/:id/messages returns 404 for a non-existent Conversation", async () => {
    const res = await app.request("/conversations/does-not-exist/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });

    expect(res.status).toBe(404);
  });

  it("committed assistant message on the Turn is persisted as an assistant Message in the Conversation", async () => {
    const createRes = await app.request("/conversations", { method: "POST" });
    const { conversation } = await json(createRes);

    const msgRes = await app.request(`/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Tell me something" }),
    });
    const { message, turn } = await json(msgRes);

    // The turn's committedAssistantMessageId must equal the returned assistant message id
    expect(turn.committedAssistantMessageId).toBe(message.id);

    // That same message must be readable under the conversation's message list
    const listRes = await app.request(`/conversations/${conversation.id}/messages`);
    expect(listRes.status).toBe(200);
    const { messages } = await json(listRes);

    const assistant = messages.find((m: { id: string }) => m.id === message.id);
    expect(assistant).toBeDefined();
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe(message.content);
  });

  it("uses an injected provider so the assistant reply reflects the provider's response", async () => {
    const customSdk = createAiSdk([
      {
        name: "openrouter",
        defaultModel: "openai/gpt-4o",
        complete: async () => "Hello from custom provider!",
      },
    ]);
    const customDir = await mkdtemp(join(tmpdir(), "tardis-server-custom-"));
    const customApp = await createApp({
      databaseUrl: `file:${join(customDir, "test.db")}`,
      aiSdk: customSdk,
      model: "openai/gpt-4o",
    });

    try {
      const createRes = await customApp.request("/conversations", { method: "POST" });
      const { conversation } = await json(createRes);

      const msgRes = await customApp.request(`/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hi" }),
      });

      const { message, inferenceRequest } = await json(msgRes);
      expect(message.content).toBe("Hello from custom provider!");
      expect(inferenceRequest.provider).toBe("openrouter");
      expect(inferenceRequest.model).toBe("openai/gpt-4o");
    } finally {
      await rm(customDir, { recursive: true, force: true });
    }
  });

  it("returns 500 when inference provider fails", async () => {
    const failingSdk = createAiSdk([
      {
        name: "openrouter",
        defaultModel: "openai/gpt-4o",
        complete: async () => {
          throw new Error("boom");
        },
      },
    ]);
    const failingDir = await mkdtemp(join(tmpdir(), "tardis-server-failing-"));
    const failingApp = await createApp({
      databaseUrl: `file:${join(failingDir, "test.db")}`,
      aiSdk: failingSdk,
    });

    try {
      const createRes = await failingApp.request("/conversations", { method: "POST" });
      const { conversation } = await json(createRes);

      const msgRes = await failingApp.request(`/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hi" }),
      });

      expect(msgRes.status).toBe(500);
    } finally {
      await rm(failingDir, { recursive: true, force: true });
    }
  });

  it("POST /conversations/:id/messages/stream returns incremental assistant deltas before completion", async () => {
    const streamingSdk = createAiSdk([
      {
        name: "openrouter",
        defaultModel: "openai/gpt-4o",
        complete: async () => "unused",
        async *stream() {
          yield { type: "response_start" } as const;
          yield { type: "text_delta", text: "Hello" } as const;
          yield { type: "text_delta", text: " world" } as const;
          yield {
            type: "usage",
            usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          } as const;
          yield { type: "request_end" } as const;
        },
      },
    ]);

    const streamingDir = await mkdtemp(join(tmpdir(), "tardis-server-streaming-"));
    const streamingDatabaseUrl = `file:${join(streamingDir, "test.db")}`;
    const streamingApp = await createApp({
      databaseUrl: streamingDatabaseUrl,
      aiSdk: streamingSdk,
    });

    try {
      const createRes = await streamingApp.request("/conversations", { method: "POST" });
      const { conversation } = await json(createRes);

      const streamRes = await streamingApp.request(`/conversations/${conversation.id}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hi" }),
      });

      expect(streamRes.status).toBe(201);
      const events = await readNdjson(streamRes);

      expect(events[0]).toEqual({ type: "assistant_delta", delta: "Hello" });
      expect(events[1]).toEqual({ type: "assistant_delta", delta: " world" });
      expect(events.at(-1)?.type).toBe("completed");

      const completed = events.at(-1) as { type: "completed"; result: { inferenceRequest: { id: string } } };
      const db = createDb(streamingDatabaseUrl);
      const lifecycleEvents = await listInferenceEvents(db, completed.result.inferenceRequest.id);

      expect(lifecycleEvents.map((event) => event.type)).toEqual([
        "response_start",
        "first_token",
        "usage",
        "request_end",
      ]);

      const latency = computeLatencyFromEvents(lifecycleEvents);
      expect(latency.firstTokenLatencyMs).not.toBeNull();
      expect(latency.totalDurationMs).not.toBeNull();
      expect(latency.totalDurationMs).toBeGreaterThanOrEqual(latency.firstTokenLatencyMs ?? 0);
    } finally {
      await rm(streamingDir, { recursive: true, force: true });
    }
  });

  it("GET /inference-requests/:id returns inspection detail for an Inference Request", async () => {
    const createRes = await app.request("/conversations", { method: "POST" });
    const { conversation } = await json(createRes);

    const msgRes = await app.request(`/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Inspect this request" }),
    });

    expect(msgRes.status).toBe(201);
    const { inferenceRequest } = await json(msgRes);

    const inspectionRes = await app.request(`/inference-requests/${inferenceRequest.id}`);
    expect(inspectionRes.status).toBe(200);

    const inspectionBody = await json(inspectionRes);
    expect(inspectionBody.inferenceRequest).toMatchObject({
      id: inferenceRequest.id,
      provider: expect.any(String),
      model: expect.any(String),
      status: "completed",
      inputPreview: "Inspect this request",
      outputPreview: "I am a deterministic test response.",
    });
    expect(inspectionBody.events).toHaveLength(4);
    expect(inspectionBody.events.map((event: { type: string }) => event.type)).toEqual([
      "response_start",
      "first_token",
      "usage",
      "request_end",
    ]);
    expect(inspectionBody.events[0].payload).toBeNull();
    expect(inspectionBody.events[2].payload).toEqual({});
    expect(inspectionBody.events[2].payloadJson).toBeUndefined();
    expect(inspectionBody.summary).toMatchObject({
      eventCount: 4,
      usage: {},
      firstTokenLatencyMs: expect.any(Number),
      totalDurationMs: expect.any(Number),
    });
  });

  it("GET /inference-requests/:id returns safe previews by default without raw payloads", async () => {
    const longPrompt = "secret ".repeat(50).trim();
    const longResponse = "reply ".repeat(50).trim();
    const customSdk = createAiSdk([
      {
        name: "openrouter",
        defaultModel: "openai/gpt-4o",
        complete: async () => longResponse,
      },
    ]);
    const customDir = await mkdtemp(join(tmpdir(), "tardis-server-safe-preview-"));
    const customApp = await createApp({
      databaseUrl: `file:${join(customDir, "test.db")}`,
      aiSdk: customSdk,
      model: "openai/gpt-4o",
    });

    try {
      const createRes = await customApp.request("/conversations", { method: "POST" });
      const { conversation } = await json(createRes);

      const msgRes = await customApp.request(`/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: longPrompt }),
      });

      expect(msgRes.status).toBe(201);
      const { inferenceRequest } = await json(msgRes);

      const inspectionRes = await customApp.request(`/inference-requests/${inferenceRequest.id}`);
      expect(inspectionRes.status).toBe(200);

      const inspectionBody = await json(inspectionRes);
      expect(inspectionBody.inferenceRequest.inputPreview).toHaveLength(200);
      expect(inspectionBody.inferenceRequest.outputPreview).toHaveLength(200);
      expect(inspectionBody.inferenceRequest.rawRequestJson).toBeNull();
      expect(inspectionBody.inferenceRequest.rawResponseJson).toBeNull();
    } finally {
      await rm(customDir, { recursive: true, force: true });
    }
  });

  it("GET /inference-requests/:id applies configured redaction before persisting previews", async () => {
    const customSdk = createAiSdk([
      {
        name: "openrouter",
        defaultModel: "openai/gpt-4o",
        complete: async () => "assistant secret response",
      },
    ]);
    const customDir = await mkdtemp(join(tmpdir(), "tardis-server-redaction-"));
    const customApp = await createApp({
      databaseUrl: `file:${join(customDir, "test.db")}`,
      aiSdk: customSdk,
      model: "openai/gpt-4o",
      telemetry: {
        preview: {
          redact: (value) => value.replaceAll("secret", "[REDACTED]"),
        },
      },
    });

    try {
      const createRes = await customApp.request("/conversations", { method: "POST" });
      const { conversation } = await json(createRes);

      const msgRes = await customApp.request(`/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "user secret prompt" }),
      });

      expect(msgRes.status).toBe(201);
      const { inferenceRequest } = await json(msgRes);

      const inspectionRes = await customApp.request(`/inference-requests/${inferenceRequest.id}`);
      expect(inspectionRes.status).toBe(200);

      const inspectionBody = await json(inspectionRes);
      expect(inspectionBody.inferenceRequest.inputPreview).toBe("user [REDACTED] prompt");
      expect(inspectionBody.inferenceRequest.outputPreview).toBe("assistant [REDACTED] response");
      expect(inspectionBody.inferenceRequest.rawRequestJson).toBeNull();
      expect(inspectionBody.inferenceRequest.rawResponseJson).toBeNull();
    } finally {
      await rm(customDir, { recursive: true, force: true });
    }
  });

  it("GET /inference-requests/:id persists raw payloads only when explicitly enabled", async () => {
    const customSdk = createAiSdk([
      {
        name: "openrouter",
        defaultModel: "openai/gpt-4o",
        complete: async () => "unused",
        async *stream(messages, options, telemetry) {
          telemetry?.onRawRequest?.({ providerBody: { messages, options } });
          yield { type: "response_start" } as const;
          telemetry?.onRawResponse?.({ providerChunk: { id: "chunk-1", delta: "raw " } });
          yield { type: "text_delta", text: "raw " } as const;
          telemetry?.onRawResponse?.({ providerChunk: { id: "chunk-2", delta: "capture response" } });
          yield { type: "text_delta", text: "capture response" } as const;
          yield { type: "usage", usage: { totalTokens: 7 } } as const;
          yield { type: "request_end" } as const;
        },
      },
    ]);
    const customDir = await mkdtemp(join(tmpdir(), "tardis-server-raw-capture-"));
    const customApp = await createApp({
      databaseUrl: `file:${join(customDir, "test.db")}`,
      aiSdk: customSdk,
      model: "openai/gpt-4o",
      telemetry: {
        captureRawPayloads: true,
      },
    });

    try {
      const createRes = await customApp.request("/conversations", { method: "POST" });
      const { conversation } = await json(createRes);

      const msgRes = await customApp.request(`/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "raw capture prompt" }),
      });

      expect(msgRes.status).toBe(201);
      const { inferenceRequest } = await json(msgRes);

      const inspectionRes = await customApp.request(`/inference-requests/${inferenceRequest.id}`);
      expect(inspectionRes.status).toBe(200);

      const inspectionBody = await json(inspectionRes);
      expect(inspectionBody.inferenceRequest.rawRequestJson).toEqual(expect.any(String));
      expect(inspectionBody.inferenceRequest.rawResponseJson).toEqual(expect.any(String));

      const rawRequest = JSON.parse(inspectionBody.inferenceRequest.rawRequestJson);
      const rawResponse = JSON.parse(inspectionBody.inferenceRequest.rawResponseJson);

      expect(rawRequest).toMatchObject({
        providerBody: {
          messages: [{ role: "user", content: "raw capture prompt" }],
          options: { model: "openai/gpt-4o" },
        },
      });
      expect(rawResponse).toMatchObject({
        chunks: [
          { providerChunk: { id: "chunk-1", delta: "raw " } },
          { providerChunk: { id: "chunk-2", delta: "capture response" } },
        ],
      });
    } finally {
      await rm(customDir, { recursive: true, force: true });
    }
  });

  it("GET /inference-requests/:id/metrics returns latency metrics for an Inference Request", async () => {
    const createRes = await app.request("/conversations", { method: "POST" });
    const { conversation } = await json(createRes);

    const msgRes = await app.request(`/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Measure latency" }),
    });

    expect(msgRes.status).toBe(201);
    const { inferenceRequest } = await json(msgRes);

    const metricsRes = await app.request(`/inference-requests/${inferenceRequest.id}/metrics`);
    expect(metricsRes.status).toBe(200);

    const metricsBody = await json(metricsRes);
    expect(metricsBody).toMatchObject({
      inferenceRequestId: inferenceRequest.id,
      firstTokenLatencyMs: expect.any(Number),
      totalDurationMs: expect.any(Number),
      eventCount: 4,
    });
    expect(metricsBody.totalDurationMs).toBeGreaterThanOrEqual(metricsBody.firstTokenLatencyMs);
  });

  it("GET /conversations returns multiple Conversations ordered by most recent first", async () => {
    const res1 = await app.request("/conversations", { method: "POST" });
    const { conversation: first } = await json(res1);

    const res2 = await app.request("/conversations", { method: "POST" });
    const { conversation: second } = await json(res2);

    const listResponse = await app.request("/conversations");
    const { conversations } = await json(listResponse);

    expect(conversations).toHaveLength(2);
    expect(conversations[0].id).toBe(second.id);
    expect(conversations[1].id).toBe(first.id);
  });
});
