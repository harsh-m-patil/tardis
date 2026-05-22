import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@tardis/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@tardis/ui/components/card";
import { Input } from "@tardis/ui/components/input";
import { Skeleton } from "@tardis/ui/components/skeleton";

import { continueConversation, listMessages } from "@/lib/api";

export const Route = createFileRoute("/conversations/$id")({
  loader: ({ params }) => listMessages(params.id),
  pendingComponent: ConversationLoading,
  component: ConversationPage,
});

function ConversationLoading() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

function ConversationPage() {
  const { id } = Route.useParams();
  const messages = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();

    if (!content) {
      return;
    }

    setSending(true);
    try {
      await continueConversation(id, content);
      setDraft("");
      await router.invalidate();
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="container mx-auto flex h-full w-full max-w-5xl flex-col px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-medium">Conversation</h1>
        <span className="text-muted-foreground text-xs">{id}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-28">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm">No messages yet. Send one to start the conversation.</p>
        ) : (
          <div className="grid gap-3">
            {messages.map((message) => (
              <Card
                key={message.id}
                size="sm"
                className={message.role === "user" ? "border-l-2 border-l-primary" : ""}
              >
                <CardHeader>
                  <CardTitle className="capitalize">{message.role}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2">
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    <span className="text-muted-foreground text-[11px]">
                      {new Date(message.createdAt).toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 border-t bg-background/95 pt-4 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Send a message"
            disabled={sending}
          />
          <Button type="submit" disabled={sending || draft.trim().length === 0}>
            {sending ? "Sending..." : "Send"}
          </Button>
        </form>
      </div>
    </div>
  );
}
