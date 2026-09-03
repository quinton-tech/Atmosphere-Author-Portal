import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { effectiveUserId, requireUser } from "@/lib/session";

const bodySchema = z.object({
  messageId: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
});

/** Thumbs up/down on one of the caller's own chat messages. */
export async function POST(request: Request) {
  const user = await requireUser();
  const userId = effectiveUserId(user);

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "That request wasn't formatted the way we expected." }, { status: 400 });
  }
  const { messageId, rating } = parsed.data;

  const updated = await db
    .update(chatMessages)
    .set({ rating })
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.userId, userId)))
    .returning({ id: chatMessages.id });

  if (updated.length === 0) {
    // Never confirms whether a message exists for another user — matches the ownership-scoping
    // convention used by the file proxy (404, not 403).
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
