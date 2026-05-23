import Link from "next/link";

const featuredPages = [
  {
    title: "Quickstart",
    href: "/docs/quickstart",
    description: "Run the Runtime API locally, create a Conversation, and inspect Inference Request telemetry.",
  },
  {
    title: "Architecture",
    href: "/docs/architecture",
    description: "Understand how Runtime API, AI SDK, and the DB ingestion layer work together.",
  },
  {
    title: "AI SDK",
    href: "/docs/ai-sdk",
    description: "Provider adapter contract, canonical stream lifecycle, and normalization behavior.",
  },
  {
    title: "SDK Examples",
    href: "/docs/sdk-examples",
    description: "Copy-paste examples for complete(), stream(), telemetry hooks, and custom providers.",
  },
];

const apiLinks = [
  { title: "List Conversations", method: "GET", path: "/conversations" },
  { title: "Create Conversation", method: "POST", path: "/conversations" },
  { title: "Continue Conversation", method: "POST", path: "/conversations/:id/messages" },
  { title: "Inspect Inference Request", method: "GET", path: "/inference-requests/:id" },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-14 md:py-20">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-blue-50 via-white to-violet-50 p-8 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/70 md:p-10">
        <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl dark:bg-blue-400/20" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl dark:bg-violet-400/20" />

        <div className="relative space-y-5">
          <p className="inline-flex rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs text-fd-muted-foreground backdrop-blur dark:border-white/15 dark:bg-white/5">
            Tardis Docs · AI SDK + Runtime API
          </p>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-5xl">
            Build and inspect LLM inference with a request-first SDK and a telemetry-aware Runtime API.
          </h1>
          <p className="max-w-3xl text-fd-muted-foreground md:text-lg">
            These docs cover the provider-agnostic AI SDK, canonical lifecycle events, ingestion pipeline, and
            Conversation/Turn APIs.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/docs"
              className="rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
            >
              Open documentation
            </Link>
            <Link href="/docs/quickstart" className="rounded-md border bg-background/80 px-4 py-2 text-sm font-medium">
              Start with quickstart
            </Link>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Start here</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {featuredPages.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className="rounded-lg border p-4 transition-colors hover:bg-fd-muted/40"
            >
              <p className="font-medium">{page.title}</p>
              <p className="mt-1 text-sm text-fd-muted-foreground">{page.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Runtime API at a glance</h2>
        <div className="rounded-lg border">
          {apiLinks.map((endpoint) => (
            <div key={endpoint.path} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-b-0">
              <div>
                <p className="text-sm font-medium">{endpoint.title}</p>
                <code className="text-xs text-fd-muted-foreground">{endpoint.path}</code>
              </div>
              <span className="rounded border px-2 py-0.5 text-xs font-medium">{endpoint.method}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
