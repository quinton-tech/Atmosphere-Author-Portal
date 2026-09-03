import { listRules } from "./queries";
import { upsertRuleAction, deleteRuleAction } from "./actions";
import { PreviewForm } from "./PreviewForm";
import { PageHeader, Badge, FormError, FormSuccess, PillButton, Table, Th, Td } from "../_components/ui";

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
  { value: "in", label: "is one of (comma list)" },
  { value: "not_in", label: "is not one of (comma list)" },
  { value: "empty", label: "is empty" },
  { value: "not_empty", label: "is not empty" },
];

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const rules = await listRules();

  return (
    <div>
      <PageHeader title="Action rules" subtitle="If a property matches, show an action item on the author's book page." />

      <div className="mb-6 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      <section className="mb-8">
        <p className="eyebrow mb-2">Add a rule</p>
        <RuleForm />
      </section>

      <section className="mb-8">
        <p className="eyebrow mb-2">Configured rules</p>
        <Table>
          <thead>
            <tr>
              <Th>Property</Th>
              <Th>Operator</Th>
              <Th>Value</Th>
              <Th>Title / message</Th>
              <Th>CTA</Th>
              <Th>Severity</Th>
              <Th>Sort</Th>
              <Th>Enabled</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <Td colSpan={9}>
                  <form action={upsertRuleAction} className="grid grid-cols-12 items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="propertyName" defaultValue={r.propertyName} className="col-span-2 rounded-md border border-line bg-bg px-2 py-1 text-xs" />
                    <select name="operator" defaultValue={r.operator} className="col-span-1 rounded-md border border-line bg-bg px-1 py-1 text-xs">
                      {OPERATORS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.value}
                        </option>
                      ))}
                    </select>
                    <input
                      name="value"
                      defaultValue={Array.isArray(r.value) ? r.value.join(", ") : (r.value ?? "")}
                      placeholder="value(s)"
                      className="col-span-1 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                    />
                    <input name="title" defaultValue={r.title} placeholder="Title" className="col-span-2 rounded-md border border-line bg-bg px-2 py-1 text-xs" />
                    <input
                      name="message"
                      defaultValue={r.message}
                      placeholder="Message"
                      className="col-span-2 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                    />
                    <input
                      name="ctaLabel"
                      defaultValue={r.ctaLabel ?? ""}
                      placeholder="CTA label"
                      className="col-span-1 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                    />
                    <select name="severity" defaultValue={r.severity} className="col-span-1 rounded-md border border-line bg-bg px-1 py-1 text-xs">
                      <option value="action">action</option>
                      <option value="info">info</option>
                    </select>
                    <input
                      name="sortOrder"
                      type="number"
                      defaultValue={r.sortOrder}
                      className="col-span-1 w-14 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                    />
                    <label className="col-span-1 flex items-center gap-1 text-xs">
                      <input type="checkbox" name="enabled" defaultChecked={r.enabled} />
                    </label>
                    <div className="col-span-12 mt-1 flex items-center gap-2">
                      <input
                        name="ctaUrl"
                        defaultValue={r.ctaUrl ?? ""}
                        placeholder="CTA URL (optional)"
                        className="w-64 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                      />
                      {!r.enabled ? <Badge>Disabled</Badge> : null}
                      <PillButton>Save</PillButton>
                      <PillButton variant="danger" formAction={deleteRuleAction.bind(null, r.id)}>
                        Delete
                      </PillButton>
                    </div>
                  </form>
                </Td>
              </tr>
            ))}
            {rules.length === 0 ? (
              <tr>
                <Td colSpan={9} className="text-muted">
                  No rules yet.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </section>

      <section>
        <p className="eyebrow mb-2">Preview</p>
        <PreviewForm />
      </section>
    </div>
  );
}

function RuleForm() {
  return (
    <form action={upsertRuleAction} className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-4">
      <TextField name="propertyName" label="Property name" placeholder="developmentalEditorStatus" />
      <div className="flex flex-col gap-1">
        <label htmlFor="operator" className="eyebrow">
          Operator
        </label>
        <select id="operator" name="operator" className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink">
          {OPERATORS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <TextField name="value" label="Value(s)" placeholder="in_progress" />
      <TextField name="title" label="Title" placeholder="Manuscript needs your review" />
      <TextField name="message" label="Message" placeholder="Your editor sent notes." className="col-span-2" />
      <TextField name="ctaLabel" label="CTA label" placeholder="Review notes" />
      <TextField name="ctaUrl" label="CTA URL" placeholder="https://…" />
      <TextField name="sortOrder" label="Sort order" type="number" defaultValue="0" />
      <div className="flex flex-col gap-1">
        <label htmlFor="severity" className="eyebrow">
          Severity
        </label>
        <select id="severity" name="severity" className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink">
          <option value="action">action</option>
          <option value="info">info</option>
        </select>
      </div>
      <label className="flex items-center gap-2 self-end text-sm text-ink-2">
        <input type="checkbox" name="enabled" defaultChecked /> Enabled
      </label>
      <div className="col-span-full">
        <PillButton variant="solid">Add rule</PillButton>
      </div>
    </form>
  );
}

function TextField({
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
