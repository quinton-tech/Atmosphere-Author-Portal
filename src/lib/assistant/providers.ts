/**
 * Provider-agnostic model selection for the assistant (Vercel AI SDK v7 core + v4 provider
 * packages — versions confirmed against node_modules, see BUILD-TASKS.md brief 4).
 *
 * IMPORTANT: this file intentionally does NOT statically import "@/db" or "@/lib/env". Both of
 * those start with `import "server-only"`, which throws unconditionally when loaded outside
 * Next's bundler (e.g. under plain `tsx`, as used by `npm run assistant:eval`). Next's
 * webpack/Turbopack build resolves `server-only` to a no-op via the `react-server` export
 * condition; a bare `tsx` invocation does not set that condition, so the import throws at
 * module-evaluation time — see the final report for the recommended fix (add
 * `--conditions=react-server` to the tsx-based npm scripts).
 *
 * To keep this module safely importable from both Next route handlers AND the eval CLI script:
 * - `listAvailableModels` / `findModelInfo` / `buildModel` read only `process.env` (no db).
 * - `getActiveModel` needs `app_settings`, so it loads "@/db" via a dynamic `import()` inside
 *   the function body. That still throws if actually called from plain tsx, but merely
 *   importing this module (e.g. for `listAvailableModels`) no longer does.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { AssistantProvider } from "@/lib/types";

export type ModelInfo = {
  provider: AssistantProvider;
  modelId: string;
  displayName: string;
  /** USD per 1,000,000 input tokens, standard (non-batch, non-cached) pricing. */
  inputPricePerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPricePerMTok: number;
};

/**
 * Curated model ids, confirmed against the literal id unions shipped in each provider
 * package's `dist/index.d.ts` (not from memory — see report for exact greps used). Pricing
 * confirmed 2026-09-03 from https://platform.claude.com/docs/en/about-claude/pricing,
 * https://developers.openai.com/api/docs/pricing, and https://ai.google.dev/gemini-api/docs/pricing.
 * Prices drift over time — treat these as good defaults, not a live feed.
 */
const CURATED_MODELS: Record<AssistantProvider, ModelInfo[]> = {
  anthropic: [
    { provider: "anthropic", modelId: "claude-opus-5", displayName: "Claude Opus 5", inputPricePerMTok: 5, outputPricePerMTok: 25 },
    { provider: "anthropic", modelId: "claude-sonnet-5", displayName: "Claude Sonnet 5", inputPricePerMTok: 2, outputPricePerMTok: 10 },
    { provider: "anthropic", modelId: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", inputPricePerMTok: 1, outputPricePerMTok: 5 },
  ],
  openai: [
    { provider: "openai", modelId: "gpt-5.4", displayName: "GPT-5.4", inputPricePerMTok: 2.5, outputPricePerMTok: 15 },
    { provider: "openai", modelId: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", inputPricePerMTok: 0.75, outputPricePerMTok: 4.5 },
    { provider: "openai", modelId: "gpt-5.4-nano", displayName: "GPT-5.4 Nano", inputPricePerMTok: 0.2, outputPricePerMTok: 1.25 },
  ],
  google: [
    { provider: "google", modelId: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro", inputPricePerMTok: 2, outputPricePerMTok: 12 },
    { provider: "google", modelId: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash", inputPricePerMTok: 0.75, outputPricePerMTok: 3.75 },
  ],
};

/** Reimplementation of `configuredProviders()` from `@/lib/env`, reading `process.env` directly
 *  so this module never has to import the `server-only`-guarded env module. Keep in sync. */
function configuredProviders(): AssistantProvider[] {
  const out: AssistantProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push("anthropic");
  if (process.env.OPENAI_API_KEY) out.push("openai");
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) out.push("google");
  return out;
}

/** Curated models for every provider that has credentials configured. */
export function listAvailableModels(): ModelInfo[] {
  return configuredProviders().flatMap((provider) => CURATED_MODELS[provider]);
}

export function findModelInfo(provider: AssistantProvider, modelId: string): ModelInfo | undefined {
  return CURATED_MODELS[provider]?.find((m) => m.modelId === modelId);
}

/** Build a `LanguageModel` for a provider + model id. Does not touch env validation or the db. */
export function buildModel(provider: AssistantProvider, modelId: string): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropic(modelId);
    case "openai":
      return openai(modelId);
    case "google":
      return google(modelId);
  }
}

export type ActiveModel = { provider: AssistantProvider; modelId: string; model: LanguageModel };

type AssistantSettings = { provider?: AssistantProvider | null; model?: string | null };

/**
 * Reads `app_settings.assistant` (`{ provider, model }`, seeded to `{ null, null }` by
 * `db:seed`) and resolves it to a concrete model. Falls back to the first configured provider
 * and its flagship curated model when nothing is saved yet, or when the saved provider no
 * longer has credentials. Returns null when no provider is configured at all.
 */
export async function getActiveModel(): Promise<ActiveModel | null> {
  const available = configuredProviders();
  if (available.length === 0) return null;

  // Dynamic import: see the file-level comment. This keeps `import { listAvailableModels } from
  // "./providers"` safe under plain `tsx` (e.g. the eval CLI), which the rest of this module is
  // written to support; only calling `getActiveModel` itself needs a real Next/db runtime.
  const [{ db }, { appSettings }, { eq }] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);

  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "assistant")).limit(1);
  const settings = (row?.value as AssistantSettings | null) ?? null;

  const provider: AssistantProvider =
    settings?.provider && available.includes(settings.provider) ? settings.provider : available[0];
  const modelId =
    settings?.provider === provider && settings.model ? settings.model : CURATED_MODELS[provider][0]?.modelId;

  if (!modelId) return null;
  return { provider, modelId, model: buildModel(provider, modelId) };
}
