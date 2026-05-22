let pending: string | null = null;

export function setPendingMessage(message: string) {
  pending = message;
}

export function consumePendingMessage(): string | null {
  const msg = pending;
  pending = null;
  return msg;
}
