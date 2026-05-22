const listeners = new Set<() => void>();
const pendingTitles = new Map<string, string>();

export function derivePendingConversationTitle(content: string, maxLength = 48) {
  const normalized = content.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "New conversation";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function setPendingConversationTitle(conversationId: string, title: string | null) {
  if (title) {
    pendingTitles.set(conversationId, title);
  } else {
    pendingTitles.delete(conversationId);
  }

  for (const listener of listeners) {
    listener();
  }
}

export function getPendingConversationTitle(conversationId: string) {
  return pendingTitles.get(conversationId) ?? null;
}

export function subscribePendingConversationTitles(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
