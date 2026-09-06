import type { StageMilestone } from "@/db/schema";
import { PillButton } from "../_components/ui";
import type { ProjectSchemaEntry } from "./queries";

// Known values from the real HubSpot object, used as a fallback for the checkbox lists before the
// first sync has populated app_settings.projectSchema.
const FALLBACK_PACKAGES = ["Essential", "Premium", "Flagship", "Enterprise Publication", "Classic"];
const FALLBACK_ADD_ONS = [
  "Hardcover",
  "3rd Editorial",
  "Back-of-Book",
  "Merchandise",
  "Cold Reading",
  "Website",
  "Audiobook",
  "Blurb Matchmaking",
  "Book Trailer",
  "Pre-Proof Marketing Call",
  "Boost",
];
const RULE_OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
  { value: "in", label: "is one of (comma list)" },
  { value: "not_in", label: "is not one of (comma list)" },
  { value: "contains", label: "contains (multi-select, comma list)" },
  { value: "empty", label: "is empty" },
  { value: "not_empty", label: "is not empty" },
];

function optionsFor(schema: ProjectSchemaEntry[], name: string): string[] {
  return schema.find((p) => p.name === name)?.options ?? [];
}

function optionsHint(schema: ProjectSchemaEntry[], propertyName: string | null | undefined): string | null {
  if (!propertyName) return null;
  const options = optionsFor(schema, propertyName);
  return options.length ? `Known values: ${options.join(", ")}` : null;
}

const inputCls = "rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink";

function Field({
  name,
  label,
  placeholder,
  defaultValue,
  type = "text",
  list,
  hint,
  className = "",
}: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string | number;
  type?: string;
  list?: string;
  hint?: string | null;
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
        list={list}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className={inputCls}
      />
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function CheckboxGroup({ name, options, selected }: { name: string; options: string[]; selected: string[] }) {
  if (options.length === 0) return <p className="text-xs text-muted">No values known yet — run a sync first.</p>;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map((o) => (
        <label key={o} className="flex items-center gap-1.5 text-sm text-ink-2">
          <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} />
          {o}
        </label>
      ))}
    </div>
  );
}

/**
 * The full milestone field set, shared by the "Add a milestone" form and each configured
 * milestone's edit form. `milestone` is undefined for the add form.
 */
export function MilestoneFields({
  milestone,
  stages,
  schema,
  propertyListId,
  onDelete,
}: {
  milestone?: StageMilestone;
  stages: { key: string; label: string }[];
  schema: ProjectSchemaEntry[];
  propertyListId: string;
  onDelete?: (formData: FormData) => void | Promise<void>;
}) {
  const rule = milestone?.includeRule ?? null;
  const ruleValue = Array.isArray(rule?.property?.value) ? rule!.property!.value.join(", ") : (rule?.property?.value ?? "");
  const packageOptions = optionsFor(schema, "package").length ? optionsFor(schema, "package") : FALLBACK_PACKAGES;
  const addOnOptions = optionsFor(schema, "service_add_ons").length ? optionsFor(schema, "service_add_ons") : FALLBACK_ADD_ONS;

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
      {milestone ? <input type="hidden" name="id" value={milestone.id} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="stageKey" className="eyebrow">
            Stage
          </label>
          <select id="stageKey" name="stageKey" defaultValue={milestone?.stageKey ?? ""} className={inputCls}>
            <option value="" disabled>
              Select a stage…
            </option>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <Field name="label" label="Label" placeholder="Cold read" defaultValue={milestone?.label} />
        <Field
          name="propertyName"
          label="Property (internal name)"
          placeholder="cold_read_status"
          defaultValue={milestone?.propertyName}
          list={propertyListId}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="kind" className="eyebrow">
            Kind
          </label>
          <select id="kind" name="kind" defaultValue={milestone?.kind ?? "status"} className={inputCls}>
            <option value="status">status</option>
            <option value="date">date</option>
            <option value="flag">flag</option>
          </select>
        </div>
      </div>

      <Field name="description" label="Description" placeholder="Optional detail shown to the author" defaultValue={milestone?.description} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          name="doneValues"
          label="Done values (comma list)"
          placeholder="Completed, Completed - Pre-ID"
          defaultValue={milestone?.doneValues?.join(", ")}
          hint={optionsHint(schema, milestone?.propertyName)}
        />
        <Field
          name="hiddenValues"
          label="Hidden values (comma list)"
          placeholder="NOT publishing"
          defaultValue={milestone?.hiddenValues?.join(", ")}
        />
        <Field
          name="inProgressValues"
          label="In-progress values (optional, comma list)"
          placeholder="Leave blank: any other non-empty value"
          defaultValue={milestone?.inProgressValues?.join(", ") ?? ""}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field name="linkProperty" label="Link property" placeholder="kirkus_link" defaultValue={milestone?.linkProperty ?? ""} list={propertyListId} />
        <Field
          name="dateProperty"
          label="Date property"
          placeholder="netgalley_start_date"
          defaultValue={milestone?.dateProperty ?? ""}
          list={propertyListId}
        />
        <Field
          name="venueProperty"
          label="Venue property"
          placeholder="premier_review_venue"
          defaultValue={milestone?.venueProperty ?? ""}
          list={propertyListId}
        />
      </div>

      <div className="rounded-md border border-line bg-bg p-3">
        <p className="eyebrow mb-2">Include rule (blank = everyone; matches ANY of the below)</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">Package</p>
            <CheckboxGroup name="packages" options={packageOptions} selected={rule?.packages ?? []} />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">Service Add-ons</p>
            <CheckboxGroup name="addOns" options={addOnOptions} selected={rule?.addOns ?? []} />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            name="rulePropertyName"
            label="Or property"
            placeholder="cold_read_status"
            defaultValue={rule?.property?.name ?? ""}
            list={propertyListId}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="ruleOperator" className="eyebrow">
              Operator
            </label>
            <select id="ruleOperator" name="ruleOperator" defaultValue={rule?.property?.operator ?? ""} className={inputCls}>
              <option value="">—</option>
              {RULE_OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <Field name="ruleValue" label="Value(s)" placeholder="value or a, b, c" defaultValue={ruleValue} />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Field name="sortOrder" label="Sort order" type="number" defaultValue={milestone?.sortOrder ?? 0} className="w-28" />
        <label className="flex items-center gap-2 pb-1.5 text-sm text-ink-2">
          <input type="checkbox" name="enabled" defaultChecked={milestone?.enabled ?? true} /> Enabled
        </label>
        <div className="ml-auto flex gap-2">
          <PillButton variant="solid">{milestone ? "Save" : "Add milestone"}</PillButton>
          {milestone && onDelete ? (
            <PillButton variant="danger" formAction={onDelete}>
              Delete
            </PillButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
