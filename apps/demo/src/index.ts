import { createAiSdk, createOpenAICompatibleAdapter } from "@tardis/ai";

const prompt = process.argv.slice(2).filter((arg) => arg !== "--").join(" ") || "Explain AI in 5 words";

const sdk = createAiSdk([
  createOpenAICompatibleAdapter({
    name: "openrouter",
    defaultModel: process.env.OPENAI_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free",
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
  }),
]);

const response = await sdk.complete([{ role: "user", content: prompt }], {
  provider: "openrouter",
});

console.log(response);
