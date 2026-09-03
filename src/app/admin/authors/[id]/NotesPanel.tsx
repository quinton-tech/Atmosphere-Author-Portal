import type { notes } from "@/db/schema";
import { addNoteAction } from "./actions";
import { Badge, Card, PillButton } from "../../_components/ui";
import { fmtDateTime } from "../../_lib/format";

type Note = typeof notes.$inferSelect;

export function NotesPanel({ userId, bookId, notes: noteRows }: { userId: string; bookId: string; notes: Note[] }) {
  return (
    <div className="space-y-4">
      <form action={addNoteAction.bind(null, userId, bookId)} className="space-y-2">
        <label htmlFor="body" className="eyebrow block">
          Add a note
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={3}
          placeholder="Internal note about this book…"
          className="w-full max-w-[72ch] rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" name="visibleToAuthor" />
            Visible to author
          </label>
          <PillButton variant="solid">Add note</PillButton>
        </div>
      </form>

      <ul className="space-y-2">
        {noteRows.length === 0 ? <li className="text-sm text-muted">No notes yet.</li> : null}
        {noteRows.map((n) => (
          <li key={n.id}>
            <Card>
              <div className="mb-1 flex items-center gap-2">
                {n.visibleToAuthor ? <Badge tone="teal">Visible to author</Badge> : <Badge>Internal only</Badge>}
                <span className="text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-ink-2">{n.body}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
