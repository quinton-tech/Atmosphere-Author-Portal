import Link from "next/link";
import { formatDate, relativeTime } from "@/components/format";
import { getMessagesForUser, type MessageSummary } from "@/lib/data/messages";
import { effectiveUserId, requireUser } from "@/lib/session";

function DirectionChip({ direction }: { direction: MessageSummary["direction"] }) {
  return direction === "sent" ? (
    <span className="eyebrow inline-block rounded-full bg-teal-tint px-2 py-0.5 text-teal-ink">From your team</span>
  ) : (
    <span className="eyebrow inline-block rounded-full bg-surface px-2 py-0.5 text-ink-2">You replied</span>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-line px-8 py-14 text-center">
      <p className="text-lg font-bold text-ink">{title}</p>
      <p className="mt-2 text-ink-2">{message}</p>
    </div>
  );
}

export default async function MessagesPage() {
  const user = await requireUser();
  const { messages, unavailable, lastSyncedAt } = await getMessagesForUser(effectiveUserId(user));

  return (
    <div className="max-w-[72ch] pb-16">
      <h1 className="text-3xl font-extrabold text-ink">Messages from your team</h1>
      <p className="mt-2 text-ink-2">
        Emails your Atmosphere team has sent you, and your replies, as logged on your account.
      </p>

      {messages.length === 0 && unavailable ? (
        <EmptyState
          title="Messages aren't available yet."
          message="Check back soon, or reach out to your Author Manager directly."
        />
      ) : messages.length === 0 ? (
        <EmptyState title="No messages yet." message="Emails your team sends you will show up here." />
      ) : (
        <>
          {unavailable && (
            <p className="mt-6 rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">
              We couldn&apos;t refresh your messages just now — showing the most recent ones we have.
            </p>
          )}
          <ul className="mt-8 divide-y divide-line">
            {messages.map((m) => (
              <li key={m.id}>
                <Link href={`/messages/${m.id}`} className="block py-5 transition-colors hover:bg-surface">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <DirectionChip direction={m.direction} />
                      <span className="text-sm text-muted">{formatDate(m.sentAt)}</span>
                    </div>
                    <span className="text-sm text-ink-2">
                      {m.direction === "sent" ? m.fromName ?? m.fromEmail ?? "Atmosphere Press" : "You"}
                    </span>
                  </div>
                  <p className="mt-2 font-semibold text-ink">{m.subject ?? "(no subject)"}</p>
                  {m.snippet && <p className="mt-1 line-clamp-2 text-sm text-ink-2">{m.snippet}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {lastSyncedAt && <p className="mt-10 text-sm text-muted">Updated {relativeTime(lastSyncedAt)}.</p>}
    </div>
  );
}
