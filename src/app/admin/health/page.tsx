import { getActiveHandbook, getHealthCounts, getPropertyUnresolved, listRecentSyncRuns } from "./queries";
import { triggerSyncAction } from "./actions";
import { PageHeader, Badge, Card, FormError, FormSuccess, PillButton, Table, Th, Td } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [runs, handbook, unresolved, counts] = await Promise.all([
    listRecentSyncRuns(),
    getActiveHandbook(),
    getPropertyUnresolved(),
    getHealthCounts(),
  ]);

  return (
    <div>
      <PageHeader
        title="Health"
        subtitle="Sync status, assistant configuration, and mapping gaps."
        action={
          <div className="flex gap-2">
            <form action={triggerSyncAction.bind(null, "incremental")}>
              <PillButton>Run incremental sync</PillButton>
            </form>
            <form action={triggerSyncAction.bind(null, "full")}>
              <PillButton>Run full sync</PillButton>
            </form>
          </div>
        }
      />

      <div className="mb-6 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Authors" value={counts.users} />
        <Stat label="Books" value={counts.books} />
        <Stat label="Weekly active" value={counts.weeklyActive} />
        <Stat label="Unmapped stages" value={counts.unmappedStages} tone={counts.unmappedStages > 0 ? "warn" : "ok"} />
        <Stat label="Unresolved properties" value={unresolved.length} tone={unresolved.length > 0 ? "warn" : "ok"} />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <p className="eyebrow mb-2">Active handbook</p>
          {handbook ? (
            <div className="text-sm text-ink-2">
              <p className="font-semibold text-ink">{handbook.filename}</p>
              <p>
                {handbook.sections.length} sections · {handbook.tokenEstimate.toLocaleString()} tokens (est.)
              </p>
              <p className="text-xs text-muted">Uploaded {fmtDateTime(handbook.createdAt)}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">No active handbook. Upload one on the Handbook page.</p>
          )}
        </Card>
        <Card>
          <p className="eyebrow mb-2">Configured assistant providers</p>
          <div className="flex flex-wrap gap-2">
            {counts.configuredProviders.length === 0 ? (
              <span className="text-sm text-muted">None configured.</span>
            ) : (
              counts.configuredProviders.map((p) => (
                <Badge key={p} tone="ok">
                  {p}
                </Badge>
              ))
            )}
          </div>
        </Card>
      </div>

      {unresolved.length > 0 ? (
        <section className="mb-8">
          <p className="eyebrow mb-2">Unresolved HubSpot properties</p>
          <Card>
            <p className="mb-2 text-sm text-ink-2">
              These portal properties in <code>PROJECT_PROPERTIES</code> couldn&apos;t be matched to a HubSpot internal name at last sync.
            </p>
            <div className="flex flex-wrap gap-2">
              {unresolved.map((id) => (
                <Badge key={id} tone="warn">
                  {id}
                </Badge>
              ))}
            </div>
          </Card>
        </section>
      ) : null}

      <section>
        <p className="eyebrow mb-2">Last 20 sync runs</p>
        <Table>
          <thead>
            <tr>
              <Th>Started</Th>
              <Th>Kind</Th>
              <Th>Status</Th>
              <Th>Processed</Th>
              <Th>Created</Th>
              <Th>Updated</Th>
              <Th>Unmatched</Th>
              <Th>Errors</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <Td>{fmtDateTime(r.startedAt)}</Td>
                <Td>{r.kind}</Td>
                <Td>
                  {r.status === "ok" ? <Badge tone="ok">ok</Badge> : r.status === "error" ? <Badge tone="bad">error</Badge> : <Badge tone="warn">running</Badge>}
                </Td>
                <Td className="tabular">{r.processed}</Td>
                <Td className="tabular">{r.created}</Td>
                <Td className="tabular">{r.updated}</Td>
                <Td className="tabular">{r.unmatched}</Td>
                <Td>{r.errors.length > 0 ? <Badge tone="bad">{r.errors.length}</Badge> : "—"}</Td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <Td colSpan={8} className="text-muted">
                  No sync runs yet.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </section>
    </div>
  );
}

function Stat({ label, value, tone = "ok" }: { label: string; value: number; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <p className="eyebrow">{label}</p>
      <p className={`text-2xl font-extrabold tabular ${tone === "warn" && value > 0 ? "text-warn" : "text-ink"}`}>{value}</p>
    </Card>
  );
}
