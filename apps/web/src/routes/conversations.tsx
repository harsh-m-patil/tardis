import { Link, Outlet, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { MessageSquare, Plus, Sparkles } from "lucide-react";

import { Button } from "@tardis/ui/components/button";
import { Skeleton } from "@tardis/ui/components/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@tardis/ui/components/sidebar";

import { type Conversation, createConversation, listConversations } from "@/lib/api";
import { ModeToggle } from "@/components/mode-toggle";

export const Route = createFileRoute("/conversations")({
  loader: () => listConversations(),
  pendingComponent: ConversationsLayoutLoading,
  component: ConversationsLayout,
});

function ConversationsLayoutLoading() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-3 space-y-2">
          <Skeleton className="h-9 w-full rounded-lg" />
        </SidebarHeader>
        <SidebarContent className="p-3 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </SidebarContent>
      </Sidebar>
      <SidebarInset />
    </SidebarProvider>
  );
}

function ConversationsLayout() {
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
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center justify-between px-2 py-1">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-foreground/5 border border-border/50">
                <Sparkles className="size-3.5 text-foreground/70" />
              </div>
              <span className="text-sm font-semibold">tardis</span>
            </Link>
            <ModeToggle />
          </div>
          <div className="px-2">
            <Button
              onClick={handleCreate}
              disabled={creating}
              variant="outline"
              className="w-full rounded-lg"
              size="sm"
            >
              <Plus className="size-3.5" />
              {creating ? "Creating..." : "New Chat"}
            </Button>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Conversations</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {conversations.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    No conversations yet
                  </p>
                ) : (
                  conversations.map((conversation: Conversation) => (
                    <ConversationItem key={conversation.id} conversation={conversation} />
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-10 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ConversationItem({ conversation }: { conversation: Conversation }) {
  const shortId = conversation.id.slice(0, 8);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={
          <Link
            to="/conversations/$id"
            params={{ id: conversation.id }}
            activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
          />
        }
        tooltip={conversation.id}
      >
        <MessageSquare className="size-3.5" />
        <span>{shortId}...</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
