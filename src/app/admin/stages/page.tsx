import { listStages, listUnmappedStageValues } from "./queries";
import { upsertStageAction, deleteStageAction } from "./actions";
import { PageHeader, Badge, Card, FormError, FormSuccess, PillButton, Table, Th, Td } from "../_components/ui";

export default async function StagesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [stages, unmapped] = await Promise.all([listStages(), listUnmappedStageValues()]);

  return (
    <div>
      <PageHeader
        title="Stages"
        subtitle="Maps raw HubSpot Pipeline Stage values to the friendly stages authors see. Not linear — some stages repeat or run in parallel."
      />

      <div className="mb-6 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      <section className="mb-8">
        <p className="eyebrow mb-2">Typical path preview</p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-4">
          {stages.length === 0 ? (
            <span className="text-sm text-muted">No stages configured yet.</span>
          ) : (
            stages.map((s, i) => (
              <span key={s.key} className="flex items-center gap-2">
                <span
                  className={`eyebrow rounded-full px-3 py-1.5 tracking-normal normal-case text-[13px] ${
                    s.isTerminal ? "bg-ink text-white" : "bg-teal-tint text-teal-ink"
                  }`}
                >
                  {s.label}
                </span>
                {i < stages.length - 1 ? <span className="text-muted">→</span> : null}
              </span>
            ))
          )}
        </div>
      </section>

      {unmapped.length > 0 ? (
        <section className="mb-8">
          <p className="eyebrow mb-2">Unmapped values seen</p>
          <Card>
            <p className="mb-2 text-sm text-ink-2">
              These raw <code>Pipeline Stage</code> values appear in synced books but aren&apos;t claimed by any stage below. Add them to a
              stage&apos;s HubSpot values.
            </p>
            <div className="flex flex-wrap gap-2">
              {unmapped.map((v) => (
                <Badge key={v} tone="warn">
                  {v}
                </Badge>
              ))}
            </div>
          </Card>
        </section>
      ) : null}

      <section className="mb-8">
        <p className="eyebrow mb-2">Add a stage</p>
        <form action={upsertStageAction} className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-4">
          <Field name="key" label="Key (slug)" placeholder="developmental_editing" />
          <Field name="label" label="Label" placeholder="Developmental Editing" />
          <Field name="hubspotValues" label="HubSpot values (comma list)" placeholder="DE, Developmental Edit" className="col-span-2" />
          <Field name="description" label="Description" placeholder="What's happening now" className="col-span-2" />
          <Field name="sortOrder" label="Sort order" type="number" defaultValue="0" />
          <Field name="typicalWeeks" label="Typical weeks" type="number" />
          <label className="flex items-center gap-2 self-end text-sm text-ink-2">
            <input type="checkbox" name="isTerminal" /> Terminal stage
          </label>
          <div className="col-span-full">
            <PillButton variant="solid">Add stage</PillButton>
          </div>
        </form>
      </section>

      <section>
        <p className="eyebrow mb-2">Configured stages</p>
        <Table>
          <thead>
            <tr>
              <Th>Key</Th>
              <Th>Label</Th>
              <Th>HubSpot values</Th>
              <Th>Description</Th>
              <Th>Sort</Th>
              <Th>Weeks</Th>
              <Th>Terminal</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.key}>
                <Td colSpan={8}>
                  <form action={upsertStageAction} className="grid grid-cols-8 items-center gap-2">
                    <input type="hidden" name="key" value={s.key} />
                    <span className="font-mono text-xs">{s.key}</span>
                    <input name="label" defaultValue={s.label} className="rounded-md border border-line bg-bg px-2 py-1 text-sm" />
                    <input
                      name="hubspotValues"
                      defaultValue={s.hubspotValues.join(", ")}
                      className="rounded-md border border-line bg-bg px-2 py-1 text-sm"
                    />
                    <input
                      name="description"
                      defaultValue={s.description}
                      className="rounded-md border border-line bg-bg px-2 py-1 text-sm"
                    />
                    <input
                      name="sortOrder"
                      type="number"
                      defaultValue={s.sortOrder}
                      className="w-16 rounded-md border border-line bg-bg px-2 py-1 text-sm"
                    />
                    <input
                      name="typicalWeeks"
                      type="number"
                      defaultValue={s.typicalWeeks ?? ""}
                      className="w-16 rounded-md border border-line bg-bg px-2 py-1 text-sm"
                    />
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name="isTerminal" defaultChecked={s.isTerminal} />
                    </label>
                    <div className="flex gap-1.5">
                      <PillButton>Save</PillButton>
                      <PillButton variant="danger" formAction={deleteStageAction.bind(null, s.key)}>
                        Delete
                      </PillButton>
                    </div>
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  type = "text",
  defaultValue,
  className = "",
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  defaultValue?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={name} className="eyebrow">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
      />
    </div>
  );
}
