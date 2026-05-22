import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@tardis/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@tardis/ui/components/card";
import { Skeleton } from "@tardis/ui/components/skeleton";

import {
  type Conversation,
  createConversation,
  listConversations,
} from "@/lib/api";

export const Route = createFileRoute("/conversations/")({
  loader: () => listConversations(),
  pendingComponent: ConversationsLoading,
  component: ConversationsPage,
});

function ConversationsLoading() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-medium">Conversations</h1>
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}

function ConversationsPage() {
  const conversations = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      const conversation = await createConversation();
      await router.invalidate();
      await navigate({
        to: "/conversations/$id",
        params: { id: conversation.id },
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-medium">Conversations</h1>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? "Creating..." : "New Conversation"}
        </Button>
      </div>

      {conversations.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No conversations yet. Create one to get started.
        </p>
      ) : (
        <div className="grid gap-3">
          {conversations.map((conversation: Conversation) => (
            <Link
              key={conversation.id}
              to="/conversations/$id"
              params={{ id: conversation.id }}
              className="block"
            >
              <Card size="sm">
                <CardHeader>
                  <CardTitle>{conversation.id}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4 text-muted-foreground">
                    <span>Status: {conversation.status}</span>
                    <span>Created: {new Date(conversation.createdAt).toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
