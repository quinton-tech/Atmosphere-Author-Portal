import Link from "next/link";
import { listAuditEntries } from "./queries";
import { PageHeader, Table, Th, Td, Pagination, PillButton } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const { rows, nextCursor } = await listAuditEntries({ action: sp.action, actor: sp.actor, cursor: sp.cursor });
  const params = new URLSearchParams();
  if (sp.action) params.set("action", sp.action);
  if (sp.actor) params.set("actor", sp.actor);
  params.set("cursor", nextCursor ?? "");
  const nextHref = `/admin/log?${params.toString()}`;

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every admin mutation and view-as, most recent first." />

      <form className="mb-4 flex flex-wrap gap-2" action="/admin/log">
        <input
          type="text"
          name="action"
          defaultValue={sp.action ?? ""}
          placeholder="Filter by action (e.g. admin.invite)"
          className="w-64 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
        />
        <input
          type="text"
          name="actor"
          defaultValue={sp.actor ?? ""}
          placeholder="Filter by actor email"
          className="w-64 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
        />
        <PillButton type="submit">Filter</PillButton>
        {sp.action || sp.actor ? (
          <Link href="/admin/log" className="eyebrow self-center text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Actor</Th>
            <Th>Action</Th>
            <Th>Target</Th>
            <Th>Meta</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{fmtDateTime(r.createdAt)}</Td>
              <Td>{r.actorEmail ?? "system"}</Td>
              <Td className="font-mono text-xs">{r.action}</Td>
              <Td className="font-mono text-xs">{r.targetType ? `${r.targetType}:${r.targetId ?? ""}` : "—"}</Td>
              <Td className="max-w-xs truncate font-mono text-xs" title={JSON.stringify(r.meta)}>
                {JSON.stringify(r.meta)}
              </Td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-muted">
                No matching entries.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>

      <Pagination hasMore={!!nextCursor} nextHref={nextHref} />
    </div>
  );
}
