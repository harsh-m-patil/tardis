import { env } from "@tardis/env/web";

const BASE_URL = env.VITE_SERVER_URL;

export interface Conversation {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface Turn {
  id: string;
  conversationId: string;
  userMessageId: string;
  committedAssistantMessageId: string | null;
  status: "pending" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt: string | null;
}

export interface InferenceRequest {
  id: string;
  turnId: string;
  attemptNumber: number;
  provider: string;
  model: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  inputPreview: string | null;
  outputPreview: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface ContinueConversationResult {
  message: Message;
  turn: Turn;
  inferenceRequest: InferenceRequest;
}

export async function listConversations(): Promise<Conversation[]> {
  const response = await fetch(`${BASE_URL}/conversations`);
  if (!response.ok) {
    throw new Error(`Failed to list conversations: ${response.status}`);
  }
  const data = await response.json();
  return data.conversations;
}

export async function createConversation(): Promise<Conversation> {
  const response = await fetch(`${BASE_URL}/conversations`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Failed to create conversation: ${response.status}`);
  }
  const data = await response.json();
  return data.conversation;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const response = await fetch(`${BASE_URL}/conversations/${conversationId}/messages`);
  if (!response.ok) {
    throw new Error(`Failed to list messages: ${response.status}`);
  }
  const data = await response.json();
  return data.messages;
}

export async function continueConversation(
  conversationId: string,
  content: string,
): Promise<ContinueConversationResult> {
  const response = await fetch(`${BASE_URL}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(`Failed to continue conversation: ${response.status}`);
  }

  return response.json();
}
