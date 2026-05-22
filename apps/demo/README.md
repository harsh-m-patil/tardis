# Demo app for `@tardis/ai`

Minimal CLI demo that uses the new provider-agnostic SDK.

## Run

From repo root:

```bash
pnpm -F demo start -- "Explain tracer-bullet TDD in one paragraph"
```

Without `OPENAI_API_KEY`, it uses a deterministic local demo adapter.

With `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`), it uses the OpenAI-compatible adapter:

```bash
OPENAI_API_KEY=... pnpm -F demo start -- "Write a haiku about tests"
```

OpenRouter example:

```bash
OPENROUTER_API_KEY=... \
OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
OPENAI_MODEL=openai/gpt-4o \
OPENROUTER_SITE_URL=https://your-site.example \
OPENROUTER_APP_NAME="AI Demo" \
pnpm -F demo start -- "Write a haiku about tests"
```

Optional env vars:

- `OPENAI_MODEL` (OpenAI default: `gpt-4o-mini`, OpenRouter default: `openai/gpt-4o`)
- `OPENAI_BASE_URL` (default: `https://api.openai.com`)
- `OPENROUTER_SITE_URL` (optional `HTTP-Referer` header)
- `OPENROUTER_APP_NAME` (optional `X-OpenRouter-Title` header)
