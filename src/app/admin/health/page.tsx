import { getActiveHandbook, getHealthCounts, getPropertyUnresolved, getSyncScheduleStatus, isDemoHandbook, listRecentSyncRuns } from "./queries";
import { triggerSyncAction } from "./actions";
import { PageHeader, Badge, Card, FormError, FormSuccess, PillButton, Table, Th, Td } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [runs, handbook, unresolved, counts, syncSchedule] = await Promise.all([
    listRecentSyncRuns(),
    getActiveHandbook(),
    getPropertyUnresolved(),
    getHealthCounts(),
    getSyncScheduleStatus(),
  ]);
  const demoHandbook = isDemoHandbook(handbook);

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

      {demoHandbook ? (
        <div className="mb-8 rounded-lg border border-coral bg-coral/10 px-4 py-3">
          <p className="text-sm font-semibold text-coral-ink">
            The active handbook is the demo sample. Upload the real Author Handbook before inviting authors.
          </p>
        </div>
      ) : null}

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
              <p className="font-semibold text-ink">
                {handbook.filename} {demoHandbook ? <Badge tone="bad">Demo sample</Badge> : null}
              </p>
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

      <section className="mb-8">
        <p className="eyebrow mb-2">Sync schedule (approximate)</p>
        <p className="mb-2 text-xs text-muted">
          <code>sync_runs</code> doesn&apos;t record who triggered a run, so this is inferred from the audit log — a run that started
          within 60 seconds of a &ldquo;Run sync&rdquo; click above is treated as manual.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <p className="eyebrow">Last automatic sync</p>
            {syncSchedule.lastAutomatic ? (
              <p className="text-sm text-ink">
                {fmtDateTime(syncSchedule.lastAutomatic.startedAt)} — {syncSchedule.lastAutomatic.kind}{" "}
                {syncSchedule.lastAutomatic.status === "ok" ? (
                  <Badge tone="ok">ok</Badge>
                ) : syncSchedule.lastAutomatic.status === "error" ? (
                  <Badge tone="bad">error</Badge>
                ) : (
                  <Badge tone="warn">running</Badge>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted">None seen yet.</p>
            )}
          </Card>
          <Card>
            <p className="eyebrow">Last manual refresh</p>
            {syncSchedule.lastManual ? (
              <p className="text-sm text-ink">
                {fmtDateTime(syncSchedule.lastManual.triggeredAt)}
                {syncSchedule.lastManual.run ? ` — ${syncSchedule.lastManual.run.kind}` : ""}
              </p>
            ) : (
              <p className="text-sm text-muted">None seen yet.</p>
            )}
          </Card>
        </div>
      </section>

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
                <Td className="whitespace-nowrap">{fmtDateTime(r.startedAt)}</Td>
                <Td>{r.kind}</Td>
                <Td>
                  {r.status === "ok" ? <Badge tone="ok">ok</Badge> : r.status === "error" ? <Badge tone="bad">error</Badge> : <Badge tone="warn">running</Badge>}
                </Td>
                <Td className="tabular">{r.processed}</Td>
                <Td className="tabular">{r.created}</Td>
                <Td className="tabular">{r.updated}</Td>
                <Td className="tabular">{r.unmatched}</Td>
                <Td>
                  {r.errors.length > 0 ? (
                    <details>
                      <summary className="cursor-pointer">
                        <Badge tone="bad">{r.errors.length}</Badge>
                      </summary>
                      <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface p-2 font-mono text-xs text-bad">
                        {r.errors.join("\n")}
                      </pre>
                    </details>
                  ) : (
                    "—"
                  )}
                </Td>
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
