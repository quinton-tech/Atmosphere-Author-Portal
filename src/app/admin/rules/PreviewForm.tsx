"use client";

import { useActionState } from "react";
import { previewRuleAction, type PreviewState } from "./actions";
import { Badge, Card, FormError, PillButton, Table, Th, Td } from "../_components/ui";

const initial: PreviewState = {};

export function PreviewForm() {
  const [state, formAction, pending] = useActionState(previewRuleAction, initial);
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
      {state.actions ? (
        <div className="space-y-4">
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

          {state.details && state.details.length > 0 ? (
            <div>
              <p className="eyebrow mb-2">Every rule&apos;s evaluation</p>
              <Table>
                <thead>
                  <tr>
                    <Th>Rule</Th>
                    <Th>Property</Th>
                    <Th>Cached value</Th>
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody>
                  {state.details.map((d) => (
                    <tr key={d.ruleId}>
                      <Td className="font-semibold text-ink">{d.title}</Td>
                      <Td className="font-mono text-xs">{d.propertyName}</Td>
                      <Td>
                        {d.available ? (
                          <span className="font-mono text-xs">{d.value ?? "(empty)"}</span>
                        ) : (
                          <span className="text-muted">no cached value yet</span>
                        )}
                      </Td>
                      <Td>
                        {!d.available ? (
                          <Badge tone="muted">cannot match</Badge>
                        ) : d.matched ? (
                          <Badge tone="ok">matched</Badge>
                        ) : (
                          <Badge tone="muted">no match</Badge>
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
