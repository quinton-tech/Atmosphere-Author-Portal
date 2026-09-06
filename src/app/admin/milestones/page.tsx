import { listMilestones, listStagesForSelect, getProjectSchema } from "./queries";
import { upsertMilestoneAction, deleteMilestoneAction } from "./actions";
import { MilestoneFields } from "./MilestoneFields";
import { PreviewForm } from "./PreviewForm";
import { PageHeader, FormError, FormSuccess, Badge } from "../_components/ui";

const PROPERTY_LIST_ID = "project-properties";

export default async function MilestonesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [milestones, stages, schema] = await Promise.all([listMilestones(), listStagesForSelect(), getProjectSchema()]);
  const stageLabelByKey = new Map(stages.map((s) => [s.key, s.label]));

  return (
    <div>
      <PageHeader
        title="Milestones"
        subtitle="Sub-stage checkpoints within a pipeline stage (cold read, premier review, NetGalley, …), driven by one raw HubSpot property. Not every author gets every milestone — an include rule (or an actual value) decides whether it shows."
      />

      <datalist id={PROPERTY_LIST_ID}>
        {schema.map((p) => (
          <option key={p.name} value={p.name} label={p.label} />
        ))}
      </datalist>

      <div className="mb-6 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      {schema.length === 0 ? (
        <p className="mb-6 text-sm text-muted">
          No HubSpot property schema cached yet — property name suggestions will appear here after the first sync.
        </p>
      ) : null}

      <section className="mb-8">
        <p className="eyebrow mb-2">Add a milestone</p>
        <form action={upsertMilestoneAction}>
          <MilestoneFields stages={stages} schema={schema} propertyListId={PROPERTY_LIST_ID} />
        </form>
      </section>

      <section className="mb-8">
        <p className="eyebrow mb-2">Configured milestones</p>
        <div className="space-y-4">
          {milestones.map((m) => (
            <form key={m.id} action={upsertMilestoneAction} className="relative">
              {!m.enabled ? (
                <span className="absolute right-4 top-4">
                  <Badge>Disabled</Badge>
                </span>
              ) : null}
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{stageLabelByKey.get(m.stageKey) ?? m.stageKey}</p>
              <MilestoneFields milestone={m} stages={stages} schema={schema} propertyListId={PROPERTY_LIST_ID} onDelete={deleteMilestoneAction.bind(null, m.id)} />
            </form>
          ))}
          {milestones.length === 0 ? <p className="text-sm text-muted">No milestones configured yet.</p> : null}
        </div>
      </section>

      <section>
        <p className="eyebrow mb-2">Preview</p>
        <PreviewForm />
      </section>
    </div>
  );
}
