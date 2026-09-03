/**
 * Demo fixture seeding — called from `seed.ts` when `--demo` is passed or `DEMO_MODE` is set.
 * Everything here is idempotent: safe to run repeatedly (e.g. on every deploy) without duplicating
 * rows or clobbering admin edits made in between runs. Split out of `seed.ts` per CLAUDE.md's
 * "keep files under ~300 lines" convention. See docs/DEMO.md for the resulting logins and data.
 *
 * Must be dynamically imported from inside `seed.ts`'s `main()`, after the `--conditions=react-server`
 * re-exec guard — see the comment at the top of `seed.ts` for why (this file transitively imports
 * `@/db`, which starts with `import "server-only"`).
 */
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import {
  actionRules,
  bookCache,
  books,
  handbookVersions,
  notes,
  propertyDisplay,
  stageConfig,
  users,
  visibleFiles,
  type Book,
} from "./schema";
import { hashPassword } from "@/lib/auth/password-core";
import { activateHandbook } from "@/lib/assistant/handbook";
import { estimateTokens, splitIntoSections } from "@/lib/assistant/handbook-text";
import {
  DEMO_ACTION_RULE,
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
  DEMO_AUTHOR_EMAIL,
  DEMO_AUTHOR_HUBSPOT_CONTACT_ID,
  DEMO_AUTHOR_NAME,
  DEMO_AUTHOR_PASSWORD,
  DEMO_BOOK_1,
  DEMO_BOOK_2,
  DEMO_HANDBOOK_FILENAME,
  DEMO_NOTE_BODY,
  DEMO_PROPERTY_DISPLAY,
  DEMO_STAGE_HUBSPOT_VALUES,
  DEMO_VISIBLE_FILES,
  demoBook1Properties,
  demoBook2Properties,
} from "./demo-data";

async function upsertPasswordUser(input: {
  email: string;
  name: string;
  role: "admin" | "author";
  password: string;
  hubspotContactId?: string;
}): Promise<string> {
  const email = input.email.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.log(`[seed:demo] user ${email} already exists`);
    return existing.id;
  }
  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(users)
    .values({
      email,
      name: input.name,
      role: input.role,
      passwordHash,
      hubspotContactId: input.hubspotContactId ?? null,
      emailVerified: new Date(),
    })
    .returning();
  console.log(`[seed:demo] created ${input.role} user ${email}`);
  return row.id;
}

async function upsertBook(userId: string, spec: { hubspotProjectId: string; title: string; driveFolderId: string | null }): Promise<Book> {
  const [row] = await db
    .insert(books)
    .values({ userId, hubspotProjectId: spec.hubspotProjectId, title: spec.title, driveFolderId: spec.driveFolderId })
    .onConflictDoUpdate({
      target: books.hubspotProjectId,
      set: { title: spec.title, driveFolderId: spec.driveFolderId, updatedAt: new Date() },
    })
    .returning();
  return row;
}

async function upsertBookCache(bookId: string, stageKey: string, properties: Record<string, string | null>): Promise<void> {
  const now = new Date();
  await db
    .insert(bookCache)
    .values({ bookId, properties, stageKey, hubspotUpdatedAt: now, syncedAt: now })
    .onConflictDoUpdate({
      target: bookCache.bookId,
      set: { properties, stageKey, hubspotUpdatedAt: now, syncedAt: now },
    });
}

/** Merges raw HubSpot dropdown values into a stage_config row's `hubspotValues`, deduped. */
async function mergeStageHubspotValues(key: string, values: string[]): Promise<void> {
  const [row] = await db.select().from(stageConfig).where(eq(stageConfig.key, key)).limit(1);
  if (!row) {
    console.warn(`[seed:demo] stage_config row "${key}" not found — run the base seed first`);
    return;
  }
  const merged = Array.from(new Set([...(row.hubspotValues ?? []), ...values]));
  await db.update(stageConfig).set({ hubspotValues: merged, updatedAt: new Date() }).where(eq(stageConfig.key, key));
}

async function upsertPropertyDisplay(rows: typeof DEMO_PROPERTY_DISPLAY): Promise<void> {
  for (const r of rows) {
    await db
      .insert(propertyDisplay)
      .values({ propertyId: r.propertyId, rawValue: r.rawValue, label: r.label })
      .onConflictDoUpdate({
        target: [propertyDisplay.propertyId, propertyDisplay.rawValue],
        set: { label: r.label },
      });
  }
  console.log(`[seed:demo] ensured ${rows.length} property_display rows`);
}

async function upsertActionRule(rule: typeof DEMO_ACTION_RULE): Promise<void> {
  const [existing] = await db
    .select({ id: actionRules.id })
    .from(actionRules)
    .where(and(eq(actionRules.propertyName, rule.propertyName), eq(actionRules.operator, rule.operator), eq(actionRules.title, rule.title)))
    .limit(1);
  if (existing) {
    console.log("[seed:demo] action_rule already exists");
    return;
  }
  await db.insert(actionRules).values({
    propertyName: rule.propertyName,
    operator: rule.operator,
    value: rule.value,
    title: rule.title,
    message: rule.message,
    ctaLabel: rule.ctaLabel,
    ctaUrl: rule.ctaUrl,
  });
  console.log("[seed:demo] created action_rule");
}

async function upsertVisibleFiles(bookId: string, files: typeof DEMO_VISIBLE_FILES): Promise<void> {
  for (const f of files) {
    await db
      .insert(visibleFiles)
      .values({ bookId, driveFileId: f.driveFileId, label: f.label, category: f.category, mimeType: f.mimeType })
      .onConflictDoUpdate({
        target: [visibleFiles.bookId, visibleFiles.driveFileId],
        set: { label: f.label, category: f.category, mimeType: f.mimeType },
      });
  }
  console.log(`[seed:demo] ensured ${files.length} visible_files rows on book ${bookId}`);
}

async function upsertNote(bookId: string, body: string): Promise<void> {
  const [existing] = await db.select({ id: notes.id }).from(notes).where(and(eq(notes.bookId, bookId), eq(notes.body, body))).limit(1);
  if (existing) {
    console.log("[seed:demo] note already exists");
    return;
  }
  await db.insert(notes).values({ bookId, body, visibleToAuthor: true, authorId: null });
  console.log("[seed:demo] created note");
}

/**
 * Ingests `src/db/demo-handbook.md` and activates it, but only the first time — re-running the
 * seed never overwrites an admin's own choice of active handbook. Text is split with the same
 * `splitIntoSections`/`estimateTokens` helpers `ingestHandbook` uses; we can't call `ingestHandbook`
 * itself because its `extractText` only understands PDF/DOCX (see src/lib/assistant/handbook-text.ts).
 */
async function seedHandbook(): Promise<void> {
  const [alreadySeeded] = await db
    .select({ id: handbookVersions.id })
    .from(handbookVersions)
    .where(eq(handbookVersions.filename, DEMO_HANDBOOK_FILENAME))
    .limit(1);
  if (alreadySeeded) {
    console.log("[seed:demo] demo handbook already ingested");
    return;
  }

  const filePath = path.join(process.cwd(), "src", "db", DEMO_HANDBOOK_FILENAME);
  const text = readFileSync(filePath, "utf8");
  const sections = splitIntoSections(text);
  const tokenEstimate = sections.length > 0 ? sections.reduce((sum, s) => sum + s.tokenEstimate, 0) : estimateTokens(text);

  const [row] = await db
    .insert(handbookVersions)
    .values({ filename: DEMO_HANDBOOK_FILENAME, uploadedById: null, text, sections, tokenEstimate, isActive: false })
    .returning();

  await activateHandbook(row.id, null);
  console.log(`[seed:demo] ingested and activated demo handbook (${sections.length} sections, ~${tokenEstimate} tokens)`);
}

export async function seedDemo(): Promise<void> {
  console.log("[seed:demo] seeding demo fixture data...");
  const now = new Date();

  await upsertPasswordUser({ email: DEMO_ADMIN_EMAIL, name: "Demo Admin", role: "admin", password: DEMO_ADMIN_PASSWORD });

  const authorId = await upsertPasswordUser({
    email: DEMO_AUTHOR_EMAIL,
    name: DEMO_AUTHOR_NAME,
    role: "author",
    password: DEMO_AUTHOR_PASSWORD,
    hubspotContactId: DEMO_AUTHOR_HUBSPOT_CONTACT_ID,
  });

  const book1 = await upsertBook(authorId, DEMO_BOOK_1);
  const book2 = await upsertBook(authorId, DEMO_BOOK_2);
  console.log(`[seed:demo] ensured books "${DEMO_BOOK_1.title}" and "${DEMO_BOOK_2.title}"`);

  await upsertBookCache(book1.id, "interior_design", demoBook1Properties(now));
  await upsertBookCache(book2.id, "developmental_editing", demoBook2Properties(now));

  for (const s of DEMO_STAGE_HUBSPOT_VALUES) await mergeStageHubspotValues(s.key, s.hubspotValues);
  console.log(`[seed:demo] mapped hubspotValues for ${DEMO_STAGE_HUBSPOT_VALUES.length} stage_config rows`);

  await upsertPropertyDisplay(DEMO_PROPERTY_DISPLAY);
  await upsertActionRule(DEMO_ACTION_RULE);
  await upsertVisibleFiles(book1.id, DEMO_VISIBLE_FILES);
  await upsertNote(book1.id, DEMO_NOTE_BODY);
  await seedHandbook();

  console.log("[seed:demo] done");
  console.log(`[seed:demo] admin login:  ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
  console.log(`[seed:demo] author login: ${DEMO_AUTHOR_EMAIL} / ${DEMO_AUTHOR_PASSWORD}`);
}
