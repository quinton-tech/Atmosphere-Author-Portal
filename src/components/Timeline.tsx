import type { TimelineEvent } from "@/lib/types";
import { cn } from "./cn";
import { formatDate } from "./format";

/**
 * PRIMARY visual for a book's production status. Event-based, not a step bar: the pipeline can
 * repeat, double back, or run stages in parallel, so this only implies order via dates, never a
 * strict sequence. Vertical on mobile, horizontal on wide screens.
 */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="flex flex-col gap-8 md:flex-row md:flex-wrap md:items-start md:gap-y-10">
      {events.map((event, i) => {
        const isLast = i === events.length - 1;
        return (
          <li key={event.id} className="relative pl-8 md:min-w-[180px] md:flex-1 md:pl-0 md:pr-4">
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-4 bottom-[-32px] left-[5px] w-px md:hidden",
                  event.isFuture ? "border-l border-dashed border-line" : "bg-line",
                )}
              />
            )}
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "hidden md:block absolute top-[5px] right-1/2 h-px w-full",
                  event.isFuture ? "border-t border-dashed border-line" : "bg-line",
                )}
              />
            )}
            <span
              className={cn(
                "absolute left-0 top-1 h-[11px] w-[11px] rounded-full md:static md:mb-3 md:block",
                event.kind === "current" && "bg-coral ring-4 ring-coral/25",
                event.kind === "milestone" && "bg-teal",
                event.kind === "assignment" && "border-2 border-teal bg-bg",
              )}
            />
            <div className={event.isFuture ? "opacity-50" : undefined}>
              <time dateTime={event.at} className="eyebrow block">
                {formatDate(event.at)}
              </time>
              <p className="mt-1 font-bold text-ink">{event.title}</p>
              {event.detail && <p className="mt-0.5 text-sm text-ink-2">{event.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
