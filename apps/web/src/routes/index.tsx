import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@tardis/ui/components/button";
import { Textarea } from "@tardis/ui/components/textarea";

import { createConversation } from "@/lib/api";
import { setPendingMessage } from "@/lib/pending-message";
import { ModeToggle } from "@/components/mode-toggle";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit() {
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    try {
      const conversation = await createConversation();
      setPendingMessage(content);
      await navigate({
        to: "/conversations/$id",
        params: { id: conversation.id },
      });
    } catch {
      toast.error("Failed to start conversation");
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center px-4">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>

      <div className="w-full max-w-2xl space-y-8">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-foreground/5 border border-border/50">
            <Sparkles className="size-7 text-foreground/80" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            What can I help you with?
          </h1>
          <p className="text-sm text-muted-foreground">
            Start a conversation with tardis
          </p>
        </div>

        <div className="relative">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            disabled={sending}
            className="min-h-28 resize-none rounded-2xl border-border/50 bg-muted/30 pr-14 pl-4 pt-4 text-sm shadow-sm focus-visible:border-foreground/20 focus-visible:ring-0"
            rows={3}
          />
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={sending || !draft.trim()}
            className="absolute right-3 bottom-3 size-8 rounded-full"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/60">
          Enter to send &middot; Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
