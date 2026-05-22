import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export const turns = sqliteTable("turns", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  userMessageId: text("user_message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "restrict" }),
  committedAssistantMessageId: text("committed_assistant_message_id").references(
    () => messages.id,
    { onDelete: "restrict" },
  ),
  status: text("status", { enum: ["pending", "completed", "failed", "cancelled"] })
    .notNull()
    .default("pending"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
});

export type Turn = typeof turns.$inferSelect;
export type NewTurn = typeof turns.$inferInsert;

export const inferenceRequests = sqliteTable("inference_requests", {
  id: text("id").primaryKey(),
  turnId: text("turn_id")
    .notNull()
    .references(() => turns.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull().default(1),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status", { enum: ["pending", "streaming", "completed", "failed", "cancelled"] })
    .notNull()
    .default("pending"),
  inputPreview: text("input_preview"),
  outputPreview: text("output_preview"),
  rawRequestJson: text("raw_request_json"),
  rawResponseJson: text("raw_response_json"),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
});

export type InferenceRequest = typeof inferenceRequests.$inferSelect;
export type NewInferenceRequest = typeof inferenceRequests.$inferInsert;

export const inferenceEvents = sqliteTable("inference_events", {
  id: text("id").primaryKey(),
  inferenceRequestId: text("inference_request_id")
    .notNull()
    .references(() => inferenceRequests.id, { onDelete: "cascade" }),
  sequenceNumber: integer("sequence_number").notNull(),
  type: text("type", { enum: ["response_start", "first_token", "usage", "request_end"] }).notNull(),
  createdAt: text("created_at").notNull(),
  payloadJson: text("payload_json"),
});

export type InferenceEvent = typeof inferenceEvents.$inferSelect;
export type NewInferenceEvent = typeof inferenceEvents.$inferInsert;
