import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/conversations/")({
  component: ConversationsIndex,
});

function ConversationsIndex() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-4">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-foreground/5 border border-border/50">
          <Sparkles className="size-6 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Select a conversation</h2>
          <p className="text-xs text-muted-foreground">
            Pick one from the sidebar or start a new chat.
          </p>
        </div>
      </div>
    </div>
  );
}
