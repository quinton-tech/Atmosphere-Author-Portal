import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "@/components/format";
import { getMessageForUser } from "@/lib/data/messages";
import { effectiveUserId, requireUser } from "@/lib/session";

export default async function MessageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const message = await getMessageForUser(effectiveUserId(user), id);
  if (!message) notFound();

  const fromLine = message.fromName
    ? message.fromEmail
      ? `${message.fromName} <${message.fromEmail}>`
      : message.fromName
    : (message.fromEmail ?? "Atmosphere Press");

  return (
    <div className="max-w-[72ch] pb-16">
      <Link href="/messages" className="text-sm font-semibold text-ink-2 hover:text-ink">
        ← Messages
      </Link>

      <h1 className="mt-4 text-2xl font-extrabold text-ink">{message.subject ?? "(no subject)"}</h1>

      <dl className="mt-4 space-y-1 text-sm text-ink-2">
        <div>
          <dt className="eyebrow inline">From </dt>
          <dd className="inline">{message.direction === "received" ? "You" : fromLine}</dd>
        </div>
        {message.toEmails.length > 0 && (
          <div>
            <dt className="eyebrow inline">To </dt>
            <dd className="inline">{message.toEmails.join(", ")}</dd>
          </div>
        )}
        <div>
          <dt className="eyebrow inline">Date </dt>
          <dd className="inline">{formatDate(message.sentAt)}</dd>
        </div>
      </dl>

      <div className="mt-8 rounded-2xl bg-surface p-6">
        {message.bodyText ? (
          <p className="whitespace-pre-wrap text-ink-2">{message.bodyText}</p>
        ) : (
          <p className="text-muted">This message has no text content.</p>
        )}
      </div>
    </div>
  );
}
