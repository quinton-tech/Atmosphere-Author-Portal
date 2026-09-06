import { notFound } from "next/navigation";
import { getChatMessageDetail } from "../queries";
import { PageHeader, Badge, Card, PillLink } from "../../_components/ui";
import { fmtDateTime } from "../../_lib/format";

export default async function ChatMessageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const message = await getChatMessageDetail(id);
  if (!message) notFound();

  return (
    <div>
      <PageHeader
        title="Chat message"
        subtitle={fmtDateTime(message.createdAt)}
        action={<PillLink href="/admin/assistant">← Assistant</PillLink>}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="eyebrow">Author</p>
          <p className="text-sm text-ink">{message.userEmail}</p>
        </Card>
        <Card>
          <p className="eyebrow">Book</p>
          <p className="text-sm text-ink">{message.bookTitle ?? "—"}</p>
        </Card>
        <Card>
          <p className="eyebrow">Provider / model</p>
          <p className="text-sm text-ink">
            {message.provider ?? "—"} {message.model ? `/ ${message.model}` : ""}
          </p>
        </Card>
        <Card>
          <p className="eyebrow">Rating</p>
          <p className="text-sm text-ink">
            {message.rating === 1 ? <Badge tone="ok">Thumbs up</Badge> : message.rating === -1 ? <Badge tone="bad">Thumbs down</Badge> : "—"}
          </p>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="eyebrow">Latency</p>
          <p className="text-sm tabular text-ink">{message.latencyMs != null ? `${message.latencyMs} ms` : "—"}</p>
        </Card>
        <Card>
          <p className="eyebrow">Input tokens</p>
          <p className="text-sm tabular text-ink">{message.inputTokens ?? "—"}</p>
        </Card>
        <Card>
          <p className="eyebrow">Output tokens</p>
          <p className="text-sm tabular text-ink">{message.outputTokens ?? "—"}</p>
        </Card>
        <Card>
          <p className="eyebrow">Cached tokens</p>
          <p className="text-sm tabular text-ink">{message.cachedTokens ?? "—"}</p>
        </Card>
      </div>

      {message.notInHandbook ? (
        <div className="mb-6">
          <Badge tone="warn">Not in handbook</Badge>
        </div>
      ) : null}

      <section className="mb-8">
        <p className="eyebrow mb-2">Question</p>
        <Card>
          <p className="whitespace-pre-wrap text-sm text-ink">{message.question}</p>
        </Card>
      </section>

      <section className="mb-8">
        <p className="eyebrow mb-2">Answer</p>
        <Card>
          <p className="whitespace-pre-wrap text-sm text-ink">{message.answer || <span className="text-muted">(empty)</span>}</p>
        </Card>
      </section>

      <section>
        <p className="eyebrow mb-2">Citations</p>
        {message.citations.length === 0 ? (
          <p className="text-sm text-muted">No citations.</p>
        ) : (
          <ul className="space-y-2">
            {message.citations.map((c, i) => (
              <li key={`${c.sectionId}-${i}`}>
                <Card>
                  <p className="text-sm font-semibold text-ink">{c.heading}</p>
                  <p className="font-mono text-xs text-muted">{c.sectionId}</p>
                  {c.quote ? <p className="mt-1 text-sm text-ink-2">&ldquo;{c.quote}&rdquo;</p> : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
