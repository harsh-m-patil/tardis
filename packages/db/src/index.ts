import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import * as schema from "./schema";
import type { Message } from "./schema";

export type Db = ReturnType<typeof createDb>;

export type InferenceUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type InferenceStreamEvent =
  | { type: "response_start" }
  | { type: "first_token" }
  | { type: "text_delta"; text: string }
  | { type: "usage"; usage: InferenceUsage }
  | { type: "request_end" };

export type InferenceRuntime = {
  provider: string;
  model: string;
  stream: (messages: Pick<Message, "role" | "content">[]) => AsyncIterable<InferenceStreamEvent>;
};

export type ContinueConversationOptions = {
  onTextChunk?: (chunk: string) => void | Promise<void>;
};

export function deriveConversationTitle(content: string, maxWords = 6, maxLength = 48) {
  const normalized = content
    .trim()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#>*_~\-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) {
    return "New conversation";
  }

  const words = normalized.split(" ").filter(Boolean);
  const summary = words.slice(0, maxWords).join(" ");

  if (!summary) {
    return "New conversation";
  }

  const title = summary.charAt(0).toUpperCase() + summary.slice(1);

  if (words.length > maxWords || title.length > maxLength) {
    return `${title.slice(0, maxLength - 1).trimEnd()}…`;
  }

  return title;
}

export function createDb(databaseUrl?: string) {
  const client = createClient({
    url: databaseUrl ?? process.env.DATABASE_URL ?? "file:local.db",
  });

  return drizzle({ client, schema });
}

async function fetchOne<T>(query: Promise<T[]>): Promise<T | undefined> {
  const [row] = await query;
  return row;
}

export async function migrate(db: ReturnType<typeof createDb>) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.run("ALTER TABLE conversations ADD COLUMN title TEXT");
  } catch (error) {
    const causeText =
      error && typeof error === "object" && "cause" in error ? String(error.cause) : "";
    const detail = `${error instanceof Error ? error.message : String(error)} ${causeText}`.toLowerCase();

    if (!detail.includes("duplicate column name")) {
      throw error;
    }
  }
  await db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      committed_assistant_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS inference_requests (
      id TEXT PRIMARY KEY NOT NULL,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      input_preview TEXT,
      output_preview TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS inference_events (
      id TEXT PRIMARY KEY NOT NULL,
      inference_request_id TEXT NOT NULL REFERENCES inference_requests(id) ON DELETE CASCADE,
      sequence_number INTEGER NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT,
      UNIQUE(inference_request_id, sequence_number)
    )
  `);
}

export async function listConversations(db: Db) {
  return db.select().from(schema.conversations).orderBy(desc(schema.conversations.createdAt));
}

export async function createConversation(db: Db) {
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.insert(schema.conversations).values({
    id,
    title: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return fetchOne(db.select().from(schema.conversations).where(eq(schema.conversations.id, id)));
}

export async function getConversation(db: Db, conversationId: string) {
  return fetchOne(db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)));
}

export async function continueConversation(
  db: Db,
  conversationId: string,
  userContent: string,
  runtime: InferenceRuntime,
  options: ContinueConversationOptions = {},
) {
  const conversation = await getConversation(db, conversationId);

  if (!conversation) {
    return null;
  }

  const now = new Date().toISOString();

  const userMessageId = randomUUID();
  await db.insert(schema.messages).values({
    id: userMessageId,
    conversationId,
    role: "user",
    content: userContent,
    createdAt: now,
  });

  if (!conversation.title) {
    await db
      .update(schema.conversations)
      .set({
        title: deriveConversationTitle(userContent),
        updatedAt: now,
      })
      .where(eq(schema.conversations.id, conversationId));
  }

  const turnId = randomUUID();
  await db.insert(schema.turns).values({
    id: turnId,
    conversationId,
    userMessageId,
    status: "pending",
    createdAt: now,
  });

  const history = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId));

  const inferenceInput = history.map((m) => ({ role: m.role, content: m.content }));

  const inferenceRequestId = randomUUID();
  const startedAt = new Date().toISOString();
  await db.insert(schema.inferenceRequests).values({
    id: inferenceRequestId,
    turnId,
    provider: runtime.provider,
    model: runtime.model,
    status: "pending",
    inputPreview: userContent.slice(0, 200),
    startedAt,
  });

  let sequenceNumber = 0;
  let assistantContent = "";
  let assistantMessageId: string | null = null;
  const canonicalEventsSeen = new Set<"response_start" | "first_token" | "usage" | "request_end">();

  async function persistCanonicalEvent(
    type: "response_start" | "first_token" | "usage" | "request_end",
    payload?: unknown,
  ) {
    if (canonicalEventsSeen.has(type)) {
      return;
    }

    canonicalEventsSeen.add(type);
    sequenceNumber += 1;

    const createdAt = new Date().toISOString();
    await db.insert(schema.inferenceEvents).values({
      id: randomUUID(),
      inferenceRequestId,
      sequenceNumber,
      type,
      createdAt,
      payloadJson: payload ? JSON.stringify(payload) : null,
    });

    if (type === "response_start") {
      await db
        .update(schema.inferenceRequests)
        .set({ status: "streaming" })
        .where(eq(schema.inferenceRequests.id, inferenceRequestId));
    }

    if (type === "request_end") {
      await db
        .update(schema.inferenceRequests)
        .set({ endedAt: createdAt })
        .where(eq(schema.inferenceRequests.id, inferenceRequestId));
    }
  }

  try {
    for await (const event of runtime.stream(inferenceInput)) {
      if (event.type === "response_start") {
        await persistCanonicalEvent("response_start");
        continue;
      }

      if (event.type === "first_token") {
        await persistCanonicalEvent("first_token");
        continue;
      }

      if (event.type === "text_delta") {
        if (!canonicalEventsSeen.has("response_start")) {
          await persistCanonicalEvent("response_start");
        }
        if (event.text.length > 0 && !canonicalEventsSeen.has("first_token")) {
          await persistCanonicalEvent("first_token");
        }

        assistantContent += event.text;
        if (event.text.length > 0) {
          await options.onTextChunk?.(event.text);
        }
        continue;
      }

      if (event.type === "usage") {
        await persistCanonicalEvent("usage", event.usage);
        continue;
      }

      if (event.type === "request_end") {
        await persistCanonicalEvent("request_end");
      }
    }

    if (!canonicalEventsSeen.has("response_start")) {
      await persistCanonicalEvent("response_start");
    }
    if (!canonicalEventsSeen.has("usage")) {
      await persistCanonicalEvent("usage", {});
    }
    if (!canonicalEventsSeen.has("request_end")) {
      await persistCanonicalEvent("request_end");
    }

    const completedAt = new Date().toISOString();

    await db
      .update(schema.inferenceRequests)
      .set({ status: "completed", outputPreview: assistantContent.slice(0, 200), endedAt: completedAt })
      .where(eq(schema.inferenceRequests.id, inferenceRequestId));

    assistantMessageId = randomUUID();
    await db.insert(schema.messages).values({
      id: assistantMessageId,
      conversationId,
      role: "assistant",
      content: assistantContent,
      createdAt: completedAt,
    });

    await db
      .update(schema.turns)
      .set({ status: "completed", committedAssistantMessageId: assistantMessageId, completedAt })
      .where(eq(schema.turns.id, turnId));
  } catch (error) {
    const endedAt = new Date().toISOString();

    await db
      .update(schema.inferenceRequests)
      .set({ status: "failed", endedAt })
      .where(eq(schema.inferenceRequests.id, inferenceRequestId));

    await db
      .update(schema.turns)
      .set({ status: "failed", completedAt: endedAt })
      .where(eq(schema.turns.id, turnId));

    throw error;
  }

  const [turn, assistantMessage, inferenceRequest] = await Promise.all([
    fetchOne(db.select().from(schema.turns).where(eq(schema.turns.id, turnId))),
    assistantMessageId
      ? fetchOne(db.select().from(schema.messages).where(eq(schema.messages.id, assistantMessageId)))
      : Promise.resolve(undefined),
    fetchOne(db.select().from(schema.inferenceRequests).where(eq(schema.inferenceRequests.id, inferenceRequestId))),
  ]);

  return { turn, message: assistantMessage, inferenceRequest };
}

export async function listMessages(db: Db, conversationId: string) {
  return db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(schema.messages.createdAt);
}

export async function listInferenceEvents(db: Db, inferenceRequestId: string) {
  return db
    .select()
    .from(schema.inferenceEvents)
    .where(eq(schema.inferenceEvents.inferenceRequestId, inferenceRequestId))
    .orderBy(schema.inferenceEvents.sequenceNumber);
}

export async function getInferenceRequestMetrics(db: Db, inferenceRequestId: string) {
  const inferenceRequest = await fetchOne(
    db.select().from(schema.inferenceRequests).where(eq(schema.inferenceRequests.id, inferenceRequestId)),
  );

  if (!inferenceRequest) {
    return null;
  }

  const events = await listInferenceEvents(db, inferenceRequestId);
  const { firstTokenLatencyMs, totalDurationMs } = computeLatencyFromEvents(events);

  return {
    inferenceRequestId,
    firstTokenLatencyMs,
    totalDurationMs,
    eventCount: events.length,
  };
}

export function computeLatencyFromEvents(events: { type: string; createdAt: string }[]) {
  const responseStart = events.find((event) => event.type === "response_start");
  const firstToken = events.find((event) => event.type === "first_token");
  const requestEnd = events.find((event) => event.type === "request_end");

  const firstTokenLatencyMs =
    responseStart && firstToken
      ? new Date(firstToken.createdAt).getTime() - new Date(responseStart.createdAt).getTime()
      : null;

  const totalDurationMs =
    responseStart && requestEnd
      ? new Date(requestEnd.createdAt).getTime() - new Date(responseStart.createdAt).getTime()
      : null;

  return { firstTokenLatencyMs, totalDurationMs };
}

export const db = createDb();

export { schema };
