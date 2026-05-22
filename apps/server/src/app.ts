import { createAiSdk, createOpenAICompatibleAdapter, type AiSdk } from "@tardis/ai";
import { createDb, createConversation, listConversations, listMessages, continueConversation, migrate } from "@tardis/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

export async function createApp(options?: {
  databaseUrl?: string;
  corsOrigin?: string;
  aiSdk?: AiSdk;
  model?: string;
}) {
  const app = new Hono();
  const db = createDb(options?.databaseUrl);

  if (!options?.aiSdk && !process.env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  const provider = createOpenAICompatibleAdapter({
    name: "openrouter",
    defaultModel: options?.model ?? process.env.OPENAI_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free",
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
  });

  const aiSdk = options?.aiSdk ?? createAiSdk([provider]);
  const providerName = provider.name;
  const model = provider.defaultModel;

  await migrate(db);

  app.use(logger());
  app.use(
    "/*",
    cors({
      origin: options?.corsOrigin ?? "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.get("/", (c) => {
    return c.text("OK");
  });

  app.get("/conversations", async (c) => {
    const conversations = await listConversations(db);

    return c.json({ conversations });
  });

  app.post("/conversations", async (c) => {
    const conversation = await createConversation(db);

    return c.json({ conversation }, 201);
  });

  app.get("/conversations/:id/messages", async (c) => {
    const conversationId = c.req.param("id");
    const messages = await listMessages(db, conversationId);
    return c.json({ messages });
  });

  app.post("/conversations/:id/messages", async (c) => {
    const conversationId = c.req.param("id");
    const { content } = await c.req.json<{ content: string }>();

    try {
      const result = await continueConversation(db, conversationId, content, {
        provider: providerName,
        model,
        complete: (messages) =>
          aiSdk.complete(messages, {
            provider: providerName,
            model,
          }),
      });

      if (!result) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      return c.json(result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown inference error";
      console.error("Inference failed", error);
      return c.json({ error: "Inference failed", details: message }, 500);
    }
  });

  return app;
}
