import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(16),
  AUTH_URL: z.string().url().optional(),
  APP_NAME: z.string().default("Atmosphere Author Portal"),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Atmosphere Press <portal@atmospherepress.com>"),

  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  HUBSPOT_PROJECT_OBJECT_TYPE: z.string().optional(),

  GOOGLE_SERVICE_ACCOUNT_JSON_B64: z.string().optional(),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

  CRON_SECRET: z.string().min(8),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * "Crazy light" preview mode: no HubSpot/Drive/LLM credentials needed. Sync is skipped, Drive
   * reads are served from `public/demo/` fixtures, and `npm run db:seed -- --demo` seeds one
   * fixture author. See docs/DEMO.md.
   */
  DEMO_MODE: z.enum(["1", "true", "0", "false"]).optional(),
});

export type Env = z.infer<typeof schema>;

const isBuild = process.env.NEXT_PHASE?.startsWith("phase-production-build") ?? false;

/** Placeholders so `next build` can evaluate route modules without real secrets. Never used at runtime. */
const BUILD_PLACEHOLDERS = {
  DATABASE_URL: "postgres://build:build@localhost:5432/build",
  AUTH_SECRET: "build-placeholder-secret-not-used",
  CRON_SECRET: "build-placeholder",
} as const;

function load(): Env {
  const parsed = schema.safeParse(isBuild ? { ...BUILD_PLACEHOLDERS, ...process.env } : process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

/**
 * Validated on first property access rather than at import, so `next build` (which evaluates
 * route modules without runtime secrets) succeeds and misconfiguration still fails loudly on
 * the first real request.
 */
export const env: Env = new Proxy({} as Env, {
  get(_t, key: string | symbol) {
    cached ??= load();
    return cached[key as keyof Env];
  },
  has(_t, key) {
    cached ??= load();
    return key in cached;
  },
  ownKeys() {
    cached ??= load();
    return Reflect.ownKeys(cached);
  },
  getOwnPropertyDescriptor(_t, key) {
    cached ??= load();
    return Object.getOwnPropertyDescriptor(cached, key);
  },
});

/** Which assistant providers have credentials configured. */
export function configuredProviders(): Array<"anthropic" | "openai" | "google"> {
  const out: Array<"anthropic" | "openai" | "google"> = [];
  if (env.ANTHROPIC_API_KEY) out.push("anthropic");
  if (env.OPENAI_API_KEY) out.push("openai");
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) out.push("google");
  return out;
}

/** True when `DEMO_MODE` is set to "1" or "true". Gates HubSpot/Drive writes and syncs, and
 *  swaps in the fixture DriveReader (`src/lib/drive/fixture.ts`). See docs/DEMO.md. */
export function isDemoMode(): boolean {
  return env.DEMO_MODE === "1" || env.DEMO_MODE === "true";
}
