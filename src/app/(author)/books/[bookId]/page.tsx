import Link from "next/link";
import { notFound } from "next/navigation";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { BookHeader } from "@/components/BookHeader";
import { LastUpdated } from "@/components/LastUpdated";
import { NotesList } from "@/components/NotesList";
import { PhaseTimeline } from "@/components/PhaseTimeline";
import { PrimaryContact } from "@/components/PrimaryContact";
import { PublishedSummary } from "@/components/PublishedSummary";
import { StatusNow } from "@/components/StatusNow";
import { TeamListWithDirectory } from "@/components/TeamList";
import { WebsiteCard } from "@/components/WebsiteCard";
import { getBookForUser } from "@/lib/data/books";
import { effectiveUserId, requireUser } from "@/lib/session";
import { nameKey } from "@/lib/team/parse";

function suggestedQuestionsFor(stage: { label: string; isTerminal: boolean } | null): string[] {
  if (!stage) {
    return ["What happens next with my book?", "Who's on my team right now?"];
  }
  if (stage.isTerminal) {
    return ["How do royalties and payments work after publication?", "How do I order more copies of my book?", "What can I do to keep promoting my book?"];
  }
  return [
    `What happens during ${stage.label}?`,
    `How long does ${stage.label} usually take?`,
    "What do I need to do right now?",
  ];
}

export default async function BookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const user = await requireUser();
  const book = await getBookForUser(effectiveUserId(user), bookId);
  if (!book) notFound();

  const isPublished = Boolean(book.currentStage?.isTerminal);
  const suggestedQuestions = suggestedQuestionsFor(
    book.currentStage ? { label: book.currentStage.label, isTerminal: book.currentStage.isTerminal } : null,
  );
  const restOfTeam = book.primaryContact
    ? book.team.filter((member) => nameKey(member.name) !== nameKey(book.primaryContact!.name))
    : book.team;

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

      <StatusNow stage={book.currentStage} actions={book.actions} nextUpdate={book.nextUpdate} />

      {isPublished && (
        <PublishedSummary
          bookId={book.id}
          milestones={book.milestones}
          website={book.website}
          suggestedQuestions={suggestedQuestions}
        />
      )}

      <section className="mt-12">
        {isPublished ? (
          <details>
            <summary className="eyebrow cursor-pointer">Production history</summary>
            <div className="mt-6">
              <PhaseTimeline phases={book.phases} />
            </div>
            <p className="mt-5 max-w-[72ch] text-sm text-muted">
              Stages can repeat, overlap, or happen out of order. Dates are when your book entered each stage.
            </p>
          </details>
        ) : (
          <>
            <h2 className="eyebrow">Where your book stands</h2>
            <div className="mt-6">
              <PhaseTimeline phases={book.phases} />
            </div>
            <p className="mt-5 max-w-[72ch] text-sm text-muted">
              Stages can repeat, overlap, or happen out of order. Dates are when your book entered each stage.
            </p>
          </>
        )}
      </section>

      {book.website && <WebsiteCard website={book.website} />}

      <section className="mt-12">
        <h2 className="eyebrow">Your team</h2>
        {book.primaryContact && (
          <div className="mt-4">
            <PrimaryContact contact={book.primaryContact} />
          </div>
        )}
        <div className={book.primaryContact ? "mt-6" : "mt-4"}>
          <TeamListWithDirectory team={restOfTeam} heading={null} />
        </div>
      </section>

      <NotesList notes={book.notes} />
      <LastUpdated syncedAt={book.syncedAt} />

      <div id="assistant" className="mt-16">
        <AssistantPanel bookId={book.id} suggestedQuestions={suggestedQuestions} />
      </div>
    </div>
  );
}
