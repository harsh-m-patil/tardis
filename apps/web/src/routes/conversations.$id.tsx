import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, Bot, User } from "lucide-react";
import { Streamdown } from "streamdown";

import { Button } from "@tardis/ui/components/button";
import { Skeleton } from "@tardis/ui/components/skeleton";
import { Textarea } from "@tardis/ui/components/textarea";

import { type Message, continueConversationStream, listMessages } from "@/lib/api";
import {
  derivePendingConversationTitle,
  setPendingConversationTitle,
} from "@/lib/conversation-titles";
import { consumePendingMessage } from "@/lib/pending-message";

export const Route = createFileRoute("/conversations/$id")({
  loader: ({ params }) => listMessages(params.id),
  pendingComponent: ConversationLoading,
  component: ConversationPage,
});

function ConversationLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6 p-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-20 rounded-md" />
            <Skeleton className="h-16 w-3/4 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

type OptimisticMessage = {
  id: string;
  role: Message["role"];
  content: string;
  createdAt: string;
  pending?: boolean;
};

function ConversationPage() {
  const { id } = Route.useParams();
  const serverMessages = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialSent = useRef(false);

  const allMessages: OptimisticMessage[] = [
    ...serverMessages,
    ...optimisticMessages,
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages]);

  useEffect(() => {
    setOptimisticMessages([]);
  }, [serverMessages]);

  useEffect(() => {
    if (!initialSent.current && serverMessages.length === 0) {
      const pending = consumePendingMessage();
      if (pending) {
        initialSent.current = true;
        sendMessage(pending);
      }
    }
  }, []);

  async function sendMessage(content: string) {
    const isFirstUserMessage = serverMessages.length === 0 && optimisticMessages.length === 0;
    if (isFirstUserMessage) {
      setPendingConversationTitle(id, derivePendingConversationTitle(content));
    }

    const optimisticUserMsg: OptimisticMessage = {
      id: `optimistic-user-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    const optimisticAssistantId = `optimistic-assistant-${Date.now()}`;
    const optimisticAssistantMsg: OptimisticMessage = {
      id: optimisticAssistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      pending: true,
    };

    setOptimisticMessages([optimisticUserMsg, optimisticAssistantMsg]);
    setSending(true);

    try {
      await continueConversationStream(id, content, {
        onAssistantDelta: (delta) => {
          setOptimisticMessages((current) =>
            current.map((message) => {
              if (message.id !== optimisticAssistantId) {
                return message;
              }

              return {
                ...message,
                content: `${message.content}${delta}`,
              };
            }),
          );
        },
      });

      setOptimisticMessages((current) =>
        current.map((message) => {
          if (message.id !== optimisticAssistantId) {
            return message;
          }

          return {
            ...message,
            pending: false,
          };
        }),
      );

      await router.invalidate();

      if (isFirstUserMessage) {
        setPendingConversationTitle(id, null);
      }
    } catch {
      toast.error("Failed to send message");
      setOptimisticMessages([]);
      if (isFirstUserMessage) {
        setPendingConversationTitle(id, null);
      }
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  async function handleSubmit() {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft("");
    await sendMessage(content);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {allMessages.length === 0 ? (
            <EmptyConversation />
          ) : (
            <div className="space-y-6">
              {allMessages.map((message) => (
                <MessageBlock key={message.id} message={message} />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border/50 bg-background">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message..."
              disabled={sending}
              className="min-h-12 max-h-40 resize-none rounded-xl border-border/50 bg-muted/30 pr-12 pl-4 pt-3 text-sm focus-visible:border-foreground/20 focus-visible:ring-0"
              rows={1}
            />
            <Button
              size="icon"
              onClick={handleSubmit}
              disabled={sending || !draft.trim()}
              className="absolute right-2.5 bottom-2.5 size-7 rounded-lg"
            >
              <ArrowUp className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBlock({ message }: { message: OptimisticMessage }) {
  const isUser = message.role === "user";

  if (message.pending && message.content.length === 0) {
    return (
      <div className="flex gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/5 border border-border/50">
          <Bot className="size-3.5 text-foreground/70" />
        </div>
        <div className="pt-0.5">
          <TypingIndicator />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/5 border border-border/50">
        {isUser ? (
          <User className="size-3.5 text-foreground/70" />
        ) : (
          <Bot className="size-3.5 text-foreground/70" />
        )}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {isUser ? "You" : "Assistant"}
        </p>
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
          <Streamdown>{message.content}</Streamdown>
          {message.pending ? <span className="ml-0.5 inline-block animate-pulse">▍</span> : null}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-2">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
    </div>
  );
}

function EmptyConversation() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-foreground/5 border border-border/50">
        <Bot className="size-6 text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Send a message to start the conversation.
        </p>
      </div>
    </div>
  );
}
