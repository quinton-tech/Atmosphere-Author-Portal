import type { WebsiteView } from "@/lib/types";
import { cn } from "./cn";
import { formatDate } from "./format";

function hostnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Shown on the book page, after Milestones, only when the author has a website in progress.
 * Second-person, on-brand: coral only calls out an expiring/expired domain (CLAUDE.md: coral is
 * reserved for "action needed"), everything else uses the teal/ink tokens.
 *
 * `domainStatus`/`domainExpiryDays` come pre-computed from `src/lib/data/books.ts` — this component
 * never calls `Date.now()`/`new Date()` itself (react-hooks/purity).
 */
export function WebsiteCard({ website }: { website: WebsiteView }) {
  const domain = hostnameOf(website.url);
  const isPast = website.domainStatus === "past";
  const isSoonOrPast = website.domainStatus === "soon" || isPast;

  return (
    <section id="website" className="mt-12 max-w-[72ch]">
      <h2 className="eyebrow">Your author website</h2>
      <p className="mt-2 text-lg font-bold text-ink">{website.status ?? "In progress"}</p>
      {domain && <p className="mt-1 text-ink-2">{domain}</p>}
      {website.domainExpiry && (
        <p className={cn("mt-1 text-sm", isSoonOrPast ? "font-semibold text-coral-ink" : "text-muted")}>
          {isPast
            ? `Domain expiration date passed on ${formatDate(website.domainExpiry)} — check with your main contact that it was renewed`
            : `Domain renews ${formatDate(website.domainExpiry)}`}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {website.url && (
          <a
            href={website.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg"
          >
            View your site
          </a>
        )}
        {website.editUrl && (
          <a
            href={website.editUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink"
          >
            Edit your site
          </a>
        )}
        <a
          href={website.hostingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink"
        >
          Manage hosting
        </a>
      </div>
    </section>
  );
}
