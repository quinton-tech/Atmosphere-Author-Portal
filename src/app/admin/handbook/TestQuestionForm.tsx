"use client";

import { useActionState } from "react";
import { testQuestionAction, type TestQuestionState } from "./actions";
import { Card, FormError, PillButton } from "../_components/ui";

const initial: TestQuestionState = {};

export function TestQuestionForm({ versions }: { versions: { id: string; filename: string; isActive: boolean }[] }) {
  const [state, formAction, pending] = useActionState(testQuestionAction, initial);
  return (
    <div>
      <form action={formAction} className="mb-3 space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="handbookVersionId" className="eyebrow">
              Version
            </label>
            <select
              id="handbookVersionId"
              name="handbookVersionId"
              defaultValue={versions.find((v) => v.isActive)?.id}
              className="w-64 rounded-md border border-line bg-bg px-3 py-1.5 text-sm"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.filename} {v.isActive ? "(active)" : ""}
                </option>
              ))}
            </select>
          </div>
          <PillButton variant="solid">{pending ? "Asking…" : "Test a question"}</PillButton>
        </div>
        <textarea
          name="question"
          required
          rows={2}
          placeholder="What happens after cover approval?"
          className="w-full max-w-[72ch] rounded-md border border-line bg-bg px-3 py-2 text-sm"
        />
      </form>
      <FormError message={state.error} />
      {state.answer ? (
        <Card>
          <p className="whitespace-pre-wrap text-sm text-ink-2">{state.answer}</p>
          {state.citations && state.citations.length > 0 ? (
            <p className="mt-2 text-xs text-muted">Sources: {state.citations.map((c) => c.heading).join(", ")}</p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
