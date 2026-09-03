"use client";

import { useActionState } from "react";
import { previewRuleAction, type PreviewState } from "./actions";
import { Badge, Card, FormError, PillButton } from "../_components/ui";

const initial: PreviewState = {};

export function PreviewForm() {
  const [state, formAction, pending] = useActionState(previewRuleAction, initial);
  return (
    <div>
      <form action={formAction} className="mb-3 flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="preview-email" className="eyebrow">
            Preview against author email
          </label>
          <input
            id="preview-email"
            name="email"
            type="email"
            required
            placeholder="author@example.com"
            className="w-72 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
          />
        </div>
        <PillButton variant="solid">{pending ? "Checking…" : "Preview"}</PillButton>
      </form>
      <FormError message={state.error} />
      {state.actions ? (
        <Card>
          <p className="mb-2 text-sm text-muted">Matched against &ldquo;{state.bookTitle}&rdquo;:</p>
          {state.actions.length === 0 ? (
            <p className="text-sm text-ink-2">No rules match — no action items would show.</p>
          ) : (
            <ul className="space-y-2">
              {state.actions.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <Badge tone={a.severity === "action" ? "warn" : "teal"}>{a.severity}</Badge>
                  <div>
                    <p className="text-sm font-semibold text-ink">{a.title}</p>
                    <p className="text-sm text-ink-2">{a.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
