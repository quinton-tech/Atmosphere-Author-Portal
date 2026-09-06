"use client";

import { useActionState } from "react";
import { previewMilestoneAction, type PreviewState } from "./actions";
import { Badge, Card, FormError, PillButton, Table, Th, Td } from "../_components/ui";

const initial: PreviewState = {};

const STATE_TONE = { done: "ok", in_progress: "teal", scheduled: "teal", pending: "muted" } as const;

export function PreviewForm() {
  const [state, formAction, pending] = useActionState(previewMilestoneAction, initial);
  return (
    <div>
      <form action={formAction} className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="preview-email" className="eyebrow">
            Preview against author email
          </label>
          <input
            id="preview-email"
            name="email"
            type="email"
            required
            defaultValue={state.email ?? ""}
            placeholder="author@example.com"
            className="w-72 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
          />
        </div>
        {state.books && state.books.length > 1 ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="preview-book" className="eyebrow">
              Book
            </label>
            <select
              id="preview-book"
              name="bookId"
              defaultValue={state.bookId}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-64 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
            >
              {state.books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>
        ) : state.bookId ? (
          <input type="hidden" name="bookId" value={state.bookId} />
        ) : null}
        <PillButton variant="solid">{pending ? "Checking…" : "Preview"}</PillButton>
      </form>
      <FormError message={state.error} />
      {state.milestones ? (
        <div className="space-y-4">
          <Card>
            <p className="mb-2 text-sm text-muted">Matched against &ldquo;{state.bookTitle}&rdquo;:</p>
            {state.milestones.length === 0 ? (
              <p className="text-sm text-ink-2">No milestones would show for this author.</p>
            ) : (
              <ul className="space-y-2">
                {state.milestones.map((m) => (
                  <li key={m.id} className="flex items-start gap-2">
                    <Badge tone={STATE_TONE[m.state]}>{m.state.replace("_", " ")}</Badge>
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {m.stageLabel} — {m.label}
                      </p>
                      {m.detail ? <p className="text-sm text-ink-2">{m.detail}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {state.details && state.details.length > 0 ? (
            <div>
              <p className="eyebrow mb-2">Every milestone&apos;s evaluation</p>
              <Table>
                <thead>
                  <tr>
                    <Th>Milestone</Th>
                    <Th>Property</Th>
                    <Th>Cached value</Th>
                    <Th>Would show</Th>
                  </tr>
                </thead>
                <tbody>
                  {state.details.map((d) => (
                    <tr key={d.milestoneId}>
                      <Td className="font-semibold text-ink">
                        {d.stageLabel} — {d.label}
                      </Td>
                      <Td className="font-mono text-xs">hs:{d.propertyName}</Td>
                      <Td>
                        {d.available ? (
                          <span className="font-mono text-xs">{d.value ?? "(empty)"}</span>
                        ) : (
                          <span className="text-muted">no cached value yet</span>
                        )}
                      </Td>
                      <Td>
                        {!d.available ? (
                          <Badge tone="muted">cannot evaluate</Badge>
                        ) : d.wouldShow ? (
                          <Badge tone={STATE_TONE[d.state ?? "pending"]}>yes — {d.state?.replace("_", " ")}</Badge>
                        ) : (
                          <Badge tone="muted">no</Badge>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
