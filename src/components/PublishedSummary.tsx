import Link from "next/link";
import type { MilestoneView, WebsiteView } from "@/lib/types";

/**
 * Shown instead of a step-progress view once the book has reached a terminal stage: a short list
 * of places the author's book now lives, plus a few prompts into the assistant. The full
 * production history moves into a collapsed <details> below this (see the book page).
 */
export function PublishedSummary({
  bookId,
  milestones,
  website,
  suggestedQuestions,
}: {
  bookId: string;
  milestones: MilestoneView[];
  website: WebsiteView | null;
  suggestedQuestions: string[];
}) {
  const destinations = milestones.filter((m) => m.state === "done" && m.href);

  return (
    <section className="mt-12 max-w-[72ch]">
      <p className="eyebrow">Your book is out</p>
      <p className="mt-2 text-ink-2">Here&rsquo;s where to find it, and where to go from here.</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {destinations.map((m) => (
          <a
            key={m.id}
            href={m.href ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink"
          >
            {m.linkLabel ?? m.label}
          </a>
        ))}
        <Link
          href={`/books/${bookId}/files`}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink"
        >
          Your files
        </Link>
        {website && (
          <a href="#website" className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink">
            Your author website
          </a>
        )}
      </div>

      {suggestedQuestions.length > 0 && (
        <div className="mt-6">
          <p className="eyebrow text-muted">Ask the assistant</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {suggestedQuestions.slice(0, 3).map((q) => (
              <li key={q}>
                <a
                  href="#assistant"
                  className="inline-block rounded-full bg-teal-tint px-4 py-2 text-left text-sm font-medium text-teal-ink"
                >
                  {q}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
