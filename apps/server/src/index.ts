import { serve } from "@hono/node-server";
import { env } from "@tardis/env/server";

import { createApp } from "./app";

const app = await createApp({
  databaseUrl: env.DATABASE_URL,
  corsOrigin: env.CORS_ORIGIN,
});

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
