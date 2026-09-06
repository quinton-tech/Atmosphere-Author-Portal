import Link from "next/link";
import { listAuditEntries } from "./queries";
import { PageHeader, Table, Th, Td, Pagination, PillButton } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";
import { hasPrevPage, trailPop, trailPush } from "../_lib/cursor";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; cursor?: string; trail?: string }>;
}) {
  const sp = await searchParams;
  const { rows, nextCursor } = await listAuditEntries({ action: sp.action, actor: sp.actor, cursor: sp.cursor });

  const nextParams = new URLSearchParams();
  if (sp.action) nextParams.set("action", sp.action);
  if (sp.actor) nextParams.set("actor", sp.actor);
  nextParams.set("cursor", nextCursor ?? "");
  nextParams.set("trail", trailPush(sp.trail, sp.cursor));
  const nextHref = `/admin/log?${nextParams.toString()}`;

  let prevHref: string | null = null;
  if (hasPrevPage(sp.trail)) {
    const { cursor: prevCursor, trail: remainingTrail } = trailPop(sp.trail);
    const prevParams = new URLSearchParams();
    if (sp.action) prevParams.set("action", sp.action);
    if (sp.actor) prevParams.set("actor", sp.actor);
    if (prevCursor) prevParams.set("cursor", prevCursor);
    if (remainingTrail) prevParams.set("trail", remainingTrail);
    prevHref = `/admin/log?${prevParams.toString()}`;
  }

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
              <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
              <Td>{r.actorEmail ?? "system"}</Td>
              <Td className="font-mono text-xs">{r.action}</Td>
              <Td className="font-mono text-xs">{r.targetType ? `${r.targetType}:${r.targetId ?? ""}` : "—"}</Td>
              <Td>
                {r.meta && Object.keys(r.meta).length > 0 ? (
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-teal-ink">Details</summary>
                    <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface p-2 font-mono text-xs text-ink-2">
                      {JSON.stringify(r.meta, null, 2)}
                    </pre>
                  </details>
                ) : (
                  <span className="text-muted">—</span>
                )}
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

      <Pagination hasMore={!!nextCursor} nextHref={nextHref} prevHref={prevHref} />
    </div>
  );
}
