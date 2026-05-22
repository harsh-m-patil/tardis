import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAiSdk } from "@tardis/ai";

import { createApp } from "./app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response) => res.json() as Promise<any>;

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
