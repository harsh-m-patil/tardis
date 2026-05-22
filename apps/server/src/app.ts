import { createAiSdk, createOpenAICompatibleAdapter, type AiSdk } from "@tardis/ai";
import {
  continueConversation,
  createConversation,
  createDb,
  getConversation,
  getInferenceRequestInspection,
  getInferenceRequestMetrics,
  listConversations,
  listMessages,
  migrate,
  type TelemetryConfig,
} from "@tardis/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

export async function createApp(options?: {
  databaseUrl?: string;
  corsOrigin?: string;
  aiSdk?: AiSdk;
  model?: string;
  telemetry?: TelemetryConfig;
}) {
  const app = new Hono();
  const db = createDb(options?.databaseUrl);

  if (!options?.aiSdk && !process.env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  const provider = createOpenAICompatibleAdapter({
    name: "openrouter",
    defaultModel:
      options?.model ??
      process.env.OPENROUTER_MODEL ??
      process.env.OPENAI_MODEL ??
      "openai/gpt-4o-mini",
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
      const result = await continueConversation(
        db,
        conversationId,
        content,
        {
          provider: providerName,
          model,
          stream: (messages, telemetry) =>
            aiSdk.stream(messages, {
              provider: providerName,
              model,
              onRawRequest: telemetry?.onRawRequest,
              onRawResponse: telemetry?.onRawResponse,
            }),
        },
        {
          telemetry: options?.telemetry,
        },
      );

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

  app.get("/inference-requests/:id", async (c) => {
    const inferenceRequestId = c.req.param("id");
    const inspection = await getInferenceRequestInspection(db, inferenceRequestId);

    if (!inspection) {
      return c.json({ error: "Inference Request not found" }, 404);
    }

    return c.json(inspection);
  });

  app.get("/inference-requests/:id/metrics", async (c) => {
    const inferenceRequestId = c.req.param("id");
    const metrics = await getInferenceRequestMetrics(db, inferenceRequestId);

    if (!metrics) {
      return c.json({ error: "Inference Request not found" }, 404);
    }

    return c.json(metrics);
  });

  app.post("/conversations/:id/messages/stream", async (c) => {
    const conversationId = c.req.param("id");
    const { content } = await c.req.json<{ content: string }>();

    const conversation = await getConversation(db, conversationId);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          const result = await continueConversation(
            db,
            conversationId,
            content,
            {
              provider: providerName,
              model,
              stream: (messages, telemetry) =>
                aiSdk.stream(messages, {
                  provider: providerName,
                  model,
                  onRawRequest: telemetry?.onRawRequest,
                  onRawResponse: telemetry?.onRawResponse,
                }),
            },
            {
              telemetry: options?.telemetry,
              onTextChunk: async (chunk) => {
                push({ type: "assistant_delta", delta: chunk });
              },
            },
          );

          if (!result) {
            push({ type: "error", error: "Conversation not found" });
            return;
          }

          push({ type: "completed", result });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown inference error";
          push({ type: "error", error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 201,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}
