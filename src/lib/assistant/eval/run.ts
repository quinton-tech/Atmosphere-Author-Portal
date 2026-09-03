/**
 * Assistant eval harness. Runnable via:
 *
 *   npm run assistant:eval -- --provider=anthropic
 *   npm run assistant:eval                          # all configured providers
 *   npm run assistant:eval -- --provider=openai --model=gpt-5.4-mini
 *
 * Runs every case in `cases.json` against the flagship curated model for one or all configured
 * providers, grades each answer with a simple rubric (contains every expected keyword AND, when
 * `expectedSections` is non-empty, cites at least one of them), and prints a pass-rate / latency
 * / cost table per provider.
 *
 * This file is invoked with plain `tsx` (see package.json `assistant:eval`), NOT through Next's
 * bundler. `@/db` (and `@/lib/env`) start with `import "server-only"`, which throws
 * unconditionally unless the `react-server` export condition is set — Next sets it, bare `tsx`
 * does not (`tsx --conditions=react-server` does, but the npm script isn't invoked that way; see
 * the final report). To keep this script actually runnable, it talks to Postgres directly with
 * its own tiny client (mirroring `src/db/index.ts` minus the `server-only` guard) instead of
 * importing `@/db` or `handbook.ts`'s `getActiveHandbook`, and reads env vars straight off
 * `process.env` instead of importing `@/lib/env`. `providers.ts` and `prompt.ts`/`citations.ts`
 * are written to be safely importable from here directly (see their file-level comments).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { desc, eq } from "drizzle-orm";
import { generateText } from "ai";
import { handbookVersions, type HandbookSection } from "@/db/schema";
import { buildModel, findModelInfo, listAvailableModels, type ModelInfo } from "../providers";
import { buildPrompt } from "../prompt";
import { parseCitations } from "../citations";

// Loaded via fs + JSON.parse rather than a JSON module import, so this runs the same way
// whether tsx executes this file as CJS or ESM.
const casesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));

type EvalCase = {
  id: string;
  question: string;
  expectedKeywords: string[];
  expectedSections: string[];
  bookContext?: { title?: string; stageLabel?: string };
  note?: string;
};

type CaseResult = {
  caseId: string;
  pass: boolean;
  latencyMs: number;
  estCostUsd: number;
  answerPreview: string;
};

function parseArgs(argv: string[]): { provider?: string; model?: string } {
  const out: { provider?: string; model?: string } = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "provider") out.provider = value;
    if (key === "model") out.model = value;
  }
  return out;
}

async function loadActiveHandbookSections(): Promise<HandbookSection[]> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL is not set — running with no handbook content (every case will likely fail).");
    return [];
  }
  const db = drizzle(neon(url), { schema: { handbookVersions } });
  const [row] = await db
    .select({ sections: handbookVersions.sections })
    .from(handbookVersions)
    .where(eq(handbookVersions.isActive, true))
    .orderBy(desc(handbookVersions.createdAt))
    .limit(1);
  return row?.sections ?? [];
}

function grade(answer: string, citations: { sectionId: string }[], testCase: EvalCase): boolean {
  const lower = answer.toLowerCase();
  const keywordsOk = testCase.expectedKeywords.every((k) => lower.includes(k.toLowerCase()));
  const citationsOk =
    testCase.expectedSections.length === 0 || testCase.expectedSections.some((id) => citations.some((c) => c.sectionId === id));
  return keywordsOk && citationsOk;
}

function estimateCostUsd(info: ModelInfo | undefined, inputTokens: number | undefined, outputTokens: number | undefined): number {
  if (!info) return 0;
  return ((inputTokens ?? 0) / 1_000_000) * info.inputPricePerMTok + ((outputTokens ?? 0) / 1_000_000) * info.outputPricePerMTok;
}

async function runForModel(info: ModelInfo, sections: HandbookSection[], testCases: EvalCase[]): Promise<CaseResult[]> {
  const model = buildModel(info.provider, info.modelId);
  const results: CaseResult[] = [];

  for (const testCase of testCases) {
    const { instructions, messages } = buildPrompt({
      provider: info.provider,
      handbookSections: sections,
      bookTitle: testCase.bookContext?.title ?? null,
      stageLabel: testCase.bookContext?.stageLabel ?? null,
      history: [],
      question: testCase.question,
    });

    const startedAt = Date.now();
    try {
      const { text, usage } = await generateText({ model, instructions, messages });
      const latencyMs = Date.now() - startedAt;
      const { answer, citations } = parseCitations(text, sections);
      results.push({
        caseId: testCase.id,
        pass: grade(answer, citations, testCase),
        latencyMs,
        estCostUsd: estimateCostUsd(info, usage.inputTokens, usage.outputTokens),
        answerPreview: answer.slice(0, 80).replace(/\s+/g, " "),
      });
    } catch (error) {
      results.push({
        caseId: testCase.id,
        pass: false,
        latencyMs: Date.now() - startedAt,
        estCostUsd: 0,
        answerPreview: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return results;
}

async function main() {
  const { provider: providerArg, model: modelArg } = parseArgs(process.argv.slice(2));
  const testCases = cases as EvalCase[];

  const available = listAvailableModels();
  if (available.length === 0) {
    console.error("No assistant provider is configured (no API key env vars set). Nothing to run.");
    process.exitCode = 1;
    return;
  }

  const targets = providerArg
    ? available.filter((m) => m.provider === providerArg && (!modelArg || m.modelId === modelArg))
    : // Default: the flagship (first curated) model per configured provider.
      available.filter((m, i, all) => all.findIndex((x) => x.provider === m.provider) === i);

  if (targets.length === 0) {
    console.error(`No configured model matches --provider=${providerArg ?? ""} --model=${modelArg ?? ""}.`);
    process.exitCode = 1;
    return;
  }

  const sections = await loadActiveHandbookSections();
  if (sections.length === 0) {
    console.warn("No active handbook found — every case is expected to fail until one is uploaded and activated.");
  }

  for (const info of targets) {
    const results = await runForModel(info, sections, testCases);
    const passed = results.filter((r) => r.pass).length;
    const avgLatency = Math.round(results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length);
    const totalCost = results.reduce((sum, r) => sum + r.estCostUsd, 0);
    const modelInfo = findModelInfo(info.provider, info.modelId);

    console.log(`\n=== ${modelInfo?.displayName ?? info.modelId} (${info.provider}) ===`);
    console.table(
      results.map((r) => ({
        case: r.caseId,
        pass: r.pass ? "✓" : "✗",
        latencyMs: r.latencyMs,
        estCostUsd: r.estCostUsd.toFixed(5),
        answer: r.answerPreview,
      })),
    );
    console.log(
      `pass rate: ${passed}/${results.length} (${Math.round((passed / results.length) * 100)}%) — avg latency: ${avgLatency}ms — total est. cost: $${totalCost.toFixed(5)}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
