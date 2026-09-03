import "server-only";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

/**
 * The Auth.js Drizzle adapter inspects the db instance at construction, so it must be a real
 * Drizzle object, not lazy. neon() does not connect until the first query, so during
 * `next build` (no secrets) we hand it a placeholder URL. Full env validation lives in
 * src/lib/env.ts and runs on first real access.
 */
const isBuild = process.env.NEXT_PHASE?.startsWith("phase-production-build") ?? false;
const url = process.env.DATABASE_URL ?? (isBuild ? "postgres://build:build@localhost:5432/build" : undefined);
if (!url) throw new Error("DATABASE_URL is not set");

export const db = drizzle(neon(url), { schema });
export type Db = typeof db;
export { schema };
