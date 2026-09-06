import { requireAdmin } from "@/lib/session";
import { getMessageHealthCounts, listMessageSyncRows } from "./queries";
import { PageHeader, Table, Th, Td, Badge, Card } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";

export default async function AdminMessagesPage() {
  // Defense in depth: `src/app/admin/layout.tsx` and `src/proxy.ts` already gate every /admin
  // request, but every admin route re-checks per CLAUDE.md's hard rule.
  await requireAdmin();

  const [counts, rows] = await Promise.all([getMessageHealthCounts(), listMessageSyncRows()]);

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Sync status for authors' &ldquo;Messages from your team&rdquo; (HubSpot engagement emails). A shared lastError across every row usually means the HubSpot token is missing the sales-email-read scope."
      />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="eyebrow">Authors synced</p>
          <p className="text-2xl font-extrabold tabular text-ink">{counts.syncedAuthors}</p>
        </Card>
        <Card>
          <p className="eyebrow">Authors with an error</p>
          <p className={`text-2xl font-extrabold tabular ${counts.erroredAuthors > 0 ? "text-warn" : "text-ink"}`}>
            {counts.erroredAuthors}
          </p>
        </Card>
        <Card>
          <p className="eyebrow">Cached messages</p>
          <p className="text-2xl font-extrabold tabular text-ink">{counts.totalMessages}</p>
        </Card>
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Author</Th>
            <Th>Email</Th>
            <Th>Last synced</Th>
            <Th>Messages</Th>
            <Th>Last error</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId}>
              <Td>{r.name ?? "—"}</Td>
              <Td>{r.email}</Td>
              <Td>{fmtDateTime(r.lastSyncedAt)}</Td>
              <Td className="tabular">{r.messageCount}</Td>
              <Td>{r.lastError ? <Badge tone="bad">{r.lastError}</Badge> : "—"}</Td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-muted">
                No author has synced messages yet.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}
