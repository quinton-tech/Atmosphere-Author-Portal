import Link from "next/link";
import { listLabelGroups } from "./queries";
import { upsertLabelAction, deleteLabelAction } from "./actions";
import { PageHeader, FormError, FormSuccess, PillButton, Table, Th, Td, Badge } from "../_components/ui";
import { PROJECT_PROPERTIES } from "@/lib/hubspot/properties";

const ENUM_PROPERTIES = PROJECT_PROPERTIES.filter((p) => p.kind === "enum");

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; untranslated?: string }>;
}) {
  const sp = await searchParams;
  const onlyUntranslated = sp.untranslated === "1";
  const allGroups = await listLabelGroups();
  const groups = onlyUntranslated
    ? allGroups.map((g) => ({ ...g, rows: g.rows.filter((r) => !r.label) })).filter((g) => g.rows.length > 0)
    : allGroups;

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

      <section className="mb-8">
        <p className="eyebrow mb-2">Add a label</p>
        <p className="mb-2 text-sm text-ink-2">
          Map a value you&apos;ve seen on a book before the next sync discovers it — useful right after HubSpot adds a new dropdown option.
        </p>
        <form action={upsertLabelAction} className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="add-label-property" className="eyebrow">
              Property
            </label>
            <select
              id="add-label-property"
              name="propertyId"
              required
              className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
            >
              {ENUM_PROPERTIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.friendly ?? p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-label-raw" className="eyebrow">
              Raw value
            </label>
            <input
              id="add-label-raw"
              name="rawValue"
              required
              placeholder="in_progress"
              className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-label-label" className="eyebrow">
              Friendly label
            </label>
            <input
              id="add-label-label"
              name="label"
              required
              placeholder="What authors see"
              className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-label-description" className="eyebrow">
              Description
            </label>
            <input
              id="add-label-description"
              name="description"
              placeholder="Optional detail"
              className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
            />
          </div>
          <div className="col-span-full">
            <PillButton variant="solid">Add label</PillButton>
          </div>
        </form>
      </section>

      <div className="mb-4 flex items-center gap-2">
        <Link
          href={onlyUntranslated ? "/admin/labels" : "/admin/labels?untranslated=1"}
          className={`eyebrow rounded-full border px-3 py-1.5 tracking-normal normal-case text-[13px] ${
            onlyUntranslated ? "border-ink bg-ink text-white" : "border-line text-ink-2"
          }`}
        >
          Only untranslated values
        </Link>
      </div>

      <div className="space-y-8">
        {groups.length === 0 ? <p className="text-sm text-muted">Nothing untranslated — every known value has a friendly label.</p> : null}
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
