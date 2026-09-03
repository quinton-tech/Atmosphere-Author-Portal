import { listLabelGroups } from "./queries";
import { upsertLabelAction, deleteLabelAction } from "./actions";
import { PageHeader, FormError, FormSuccess, PillButton, Table, Th, Td, Badge } from "../_components/ui";

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const groups = await listLabelGroups();

  return (
    <div>
      <PageHeader
        title="Labels"
        subtitle="Friendly names for the raw HubSpot dropdown values authors see. Values HubSpot actually uses are pre-filled below, unlabelled until you name them."
      />

      <div className="mb-6 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.propertyId}>
            <p className="eyebrow mb-2">{g.propertyLabel}</p>
            <Table>
              <thead>
                <tr>
                  <Th className="w-56">Raw value</Th>
                  <Th>Friendly label</Th>
                  <Th>Description</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.rawValue}>
                    <Td colSpan={4}>
                      <form action={upsertLabelAction} className="grid grid-cols-12 items-center gap-2">
                        <input type="hidden" name="propertyId" value={g.propertyId} />
                        <input type="hidden" name="rawValue" value={r.rawValue} />
                        <span className="col-span-3 truncate font-mono text-xs" title={r.rawValue}>
                          {r.rawValue}
                        </span>
                        <input
                          name="label"
                          defaultValue={r.label}
                          placeholder="What authors see"
                          required
                          className="col-span-3 rounded-md border border-line bg-bg px-2 py-1 text-sm"
                        />
                        <input
                          name="description"
                          defaultValue={r.description}
                          placeholder="Optional detail"
                          className="col-span-4 rounded-md border border-line bg-bg px-2 py-1 text-sm"
                        />
                        <div className="col-span-2 flex items-center gap-1.5">
                          {!r.label ? <Badge tone="warn">Unlabelled</Badge> : null}
                          <PillButton>Save</PillButton>
                          {r.id ? (
                            <PillButton variant="danger" formAction={deleteLabelAction.bind(null, r.id)}>
                              Delete
                            </PillButton>
                          ) : null}
                        </div>
                      </form>
                    </Td>
                  </tr>
                ))}
                {g.rows.length === 0 ? (
                  <tr>
                    <Td colSpan={4} className="text-muted">
                      No values seen yet.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </section>
        ))}
      </div>
    </div>
  );
}
