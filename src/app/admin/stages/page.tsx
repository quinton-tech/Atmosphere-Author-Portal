import { listMilestonesForSelect, listStages, listUnmappedStageValues } from "./queries";
import { upsertStageAction, deleteStageAction } from "./actions";
import { PageHeader, Badge, Card, FormError, FormSuccess, PillButton } from "../_components/ui";
import type { StageConfig } from "@/db/schema";

export default async function StagesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [stages, unmapped, milestones] = await Promise.all([listStages(), listUnmappedStageValues(), listMilestonesForSelect()]);
  const pipelineStages = stages.filter((s) => s.kind !== "derived");

  return (
    <div>
      <PageHeader
        title="Stages"
        subtitle="Maps raw HubSpot Pipeline Stage values to the friendly stages authors see. Not linear — some stages repeat or run in parallel. A stage can also be “derived”: its state comes from linked milestones instead of HubSpot, for a finer-grained typical path (e.g. Cover Design) without changing HubSpot."
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
                    s.kind === "derived"
                      ? "border border-dashed border-line text-muted"
                      : s.isTerminal
                        ? "bg-ink text-white"
                        : "bg-teal-tint text-teal-ink"
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
              These raw <code>Pipeline Stage</code> values appear in synced books but aren&apos;t claimed by any pipeline stage below. Add
              them to a stage&apos;s HubSpot values.
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
        <form action={upsertStageAction}>
          <StageFields pipelineStages={pipelineStages} milestones={milestones} />
        </form>
      </section>

      <section>
        <p className="eyebrow mb-2">Configured stages</p>
        <div className="space-y-4">
          {stages.map((s) => (
            <form key={s.key} action={upsertStageAction} className="rounded-lg border border-line bg-bg p-4 shadow-card">
              <StageFields stage={s} pipelineStages={pipelineStages} milestones={milestones} onDelete={deleteStageAction.bind(null, s.key)} />
            </form>
          ))}
          {stages.length === 0 ? <p className="text-sm text-muted">No stages configured yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

type MilestoneOption = { id: string; label: string; stageKey: string };

function StageFields({
  stage,
  pipelineStages,
  milestones,
  onDelete,
}: {
  stage?: StageConfig;
  pipelineStages: Pick<StageConfig, "key" | "label">[];
  milestones: MilestoneOption[];
  onDelete?: (formData: FormData) => void | Promise<void>;
}) {
  const isDerived = stage?.kind === "derived";
  const linked = new Set(stage?.derivedMilestoneIds ?? []);
  const idPrefix = `${stage?.key ?? "new"}-`;

  return (
    <div className="space-y-3">
      {stage ? <input type="hidden" name="key" value={stage.key} /> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stage ? (
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Key</span>
            <span className="font-mono text-xs text-ink-2">{stage.key}</span>
          </div>
        ) : (
          <Field name="key" label="Key (slug)" placeholder="cover_design" idPrefix={idPrefix} />
        )}
        <Field name="label" label="Label" placeholder="Cover Design" defaultValue={stage?.label} idPrefix={idPrefix} />
        <Field
          name="description"
          label="Description"
          placeholder="What's happening now"
          defaultValue={stage?.description}
          className="col-span-2"
          idPrefix={idPrefix}
        />
        <Field name="sortOrder" label="Sort order" type="number" defaultValue={stage?.sortOrder ?? 0} idPrefix={idPrefix} />
        <Field name="typicalWeeks" label="Typical weeks" type="number" defaultValue={stage?.typicalWeeks ?? undefined} idPrefix={idPrefix} />
        <label className="flex items-center gap-2 self-end text-sm text-ink-2">
          <input type="checkbox" name="isTerminal" defaultChecked={stage?.isTerminal} /> Terminal stage
        </label>
        <div className="flex flex-col gap-1">
          <label htmlFor={`kind-${stage?.key ?? "new"}`} className="eyebrow">
            Kind
          </label>
          <select
            id={`kind-${stage?.key ?? "new"}`}
            name="kind"
            defaultValue={stage?.kind ?? "pipeline"}
            className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
          >
            <option value="pipeline">Pipeline (from HubSpot)</option>
            <option value="derived">Derived (from milestones)</option>
          </select>
        </div>
      </div>

      <details className="rounded-md border border-line bg-surface p-3" open={isDerived}>
        <summary className="eyebrow cursor-pointer select-none">Pipeline mapping (used when Kind = Pipeline)</summary>
        <div className="mt-2">
          <Field
            name="hubspotValues"
            label="HubSpot values (comma list)"
            placeholder="DE, Developmental Edit"
            defaultValue={stage?.hubspotValues.join(", ")}
            className="w-full"
          />
        </div>
      </details>

      <details className="rounded-md border border-line bg-surface p-3" open={isDerived}>
        <summary className="eyebrow cursor-pointer select-none">Derived settings (used when Kind = Derived)</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`parent-${stage?.key ?? "new"}`} className="eyebrow">
              Parent pipeline stage
            </label>
            <select
              id={`parent-${stage?.key ?? "new"}`}
              name="parentStageKey"
              defaultValue={stage?.parentStageKey ?? ""}
              className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
            >
              <option value="">— none —</option>
              {pipelineStages
                .filter((p) => p.key !== stage?.key)
                .map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end text-sm text-ink-2">
            <input type="checkbox" name="showWhenEmpty" defaultChecked={stage?.showWhenEmpty ?? true} />
            Show even with no milestones present
          </label>
        </div>
        <div className="mt-3">
          <p className="eyebrow mb-1">Linked milestones</p>
          {milestones.length === 0 ? (
            <p className="text-xs text-muted">No milestones configured yet — add some on /admin/milestones first.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {milestones.map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 text-sm text-ink-2">
                  <input type="checkbox" name="derivedMilestoneIds" value={m.id} defaultChecked={linked.has(m.id)} />
                  {m.label} <span className="text-xs text-muted">({m.stageKey})</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </details>

      <div className="flex gap-1.5">
        <PillButton variant={stage ? "ghost" : "solid"}>{stage ? "Save" : "Add stage"}</PillButton>
        {onDelete ? (
          <PillButton variant="danger" formAction={onDelete}>
            Delete
          </PillButton>
        ) : null}
      </div>
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
  idPrefix = "",
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  defaultValue?: string | number;
  className?: string;
  /** This form field set repeats once per stage (add form + one per configured stage), so the id
   *  must be unique per instance — never just `name` — or every stage's label/description/etc.
   *  collides and `<label htmlFor>` only ever focuses the first one on the page. */
  idPrefix?: string;
}) {
  const id = `${idPrefix}${name}`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
      />
    </div>
  );
}
