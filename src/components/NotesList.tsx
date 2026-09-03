import type { NoteView } from "@/lib/types";
import { formatDate } from "./format";

export function NotesList({ notes }: { notes: NoteView[] }) {
  if (notes.length === 0) return null;
  return (
    <section className="mt-12 max-w-[72ch]">
      <h2 className="eyebrow">Notes from your team</h2>
      <ul className="mt-4 space-y-4">
        {notes.map((note) => (
          <li key={note.id} className="rounded-2xl bg-surface p-5">
            <p className="whitespace-pre-wrap text-ink-2">{note.body}</p>
            <p className="mt-3 text-xs text-muted">{formatDate(note.createdAt)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
