import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionList } from "@/components/ActionList";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { BookHeader } from "@/components/BookHeader";
import { LastUpdated } from "@/components/LastUpdated";
import { NotesList } from "@/components/NotesList";
import { StageNow } from "@/components/StageNow";
import { TeamList } from "@/components/TeamList";
import { Timeline } from "@/components/Timeline";
import { TypicalPath } from "@/components/TypicalPath";
import { getBookForUser } from "@/lib/data/books";
import { effectiveUserId, requireUser } from "@/lib/session";

function suggestedQuestionsFor(stageLabel: string | null): string[] {
  if (!stageLabel) {
    return ["What happens next with my book?", "Who's on my team right now?"];
  }
  return [
    `What happens during ${stageLabel}?`,
    `How long does ${stageLabel} usually take?`,
    "What do I need to do right now?",
  ];
}

export default async function BookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const user = await requireUser();
  const book = await getBookForUser(effectiveUserId(user), bookId);
  if (!book) notFound();

  return (
    <div className="pb-16">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <BookHeader book={book} />
        <Link
          href={`/books/${book.id}/files`}
          className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink"
        >
          View files
        </Link>
      </div>

      {book.actions.length > 0 && (
        <div className="mt-8">
          <ActionList actions={book.actions} />
        </div>
      )}

      <section className="mt-12">
        <h2 className="eyebrow">Where your book stands</h2>
        <div className="mt-5">
          <Timeline events={book.timeline} />
        </div>
        <TypicalPath stages={book.stages} />
      </section>

      <StageNow stage={book.currentStage} />
      <TeamList team={book.team} />
      <NotesList notes={book.notes} />
      <LastUpdated syncedAt={book.syncedAt} />

      <div className="mt-16">
        <AssistantPanel bookId={book.id} suggestedQuestions={suggestedQuestionsFor(book.currentStage?.label ?? null)} />
      </div>
    </div>
  );
}
