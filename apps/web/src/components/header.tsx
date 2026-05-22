import { Link } from "@tanstack/react-router";
import { Bot, Home, MessageSquare } from "lucide-react";

import { Separator } from "@tardis/ui/components/separator";

import { ModeToggle } from "./mode-toggle";

export default function Header() {
  return (
    <header className="border-b">
      <div className="flex h-12 items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Bot className="size-5" />
            <span>tardis</span>
          </Link>

          <Separator orientation="vertical" className="h-5" />

          <nav className="flex items-center gap-1">
            <Link
              to="/"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground bg-muted" }}
              activeOptions={{ exact: true }}
            >
              <Home className="size-3.5" />
              Home
            </Link>
            <Link
              to="/conversations"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground bg-muted" }}
            >
              <MessageSquare className="size-3.5" />
              Conversations
            </Link>
          </nav>
        </div>

        <ModeToggle />
      </div>
    </header>
  );
}
