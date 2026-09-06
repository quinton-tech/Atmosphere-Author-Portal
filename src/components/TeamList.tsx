import type { TeamMember } from "@/lib/types";
import type { TeamMemberRow } from "@/db/schema-team";
import { nameKey } from "@/lib/team/parse";
import { getTeamDirectory } from "@/lib/data/team";
import { formatDate } from "./format";

/** Keyed by nameKey() — a plain object works for callers that don't already have a Map handy. */
export type TeamDirectory = Map<string, TeamMemberRow> | Record<string, TeamMemberRow>;

function lookup(directory: TeamDirectory | undefined, name: string): TeamMemberRow | null {
  if (!directory) return null;
  const key = nameKey(name);
  return directory instanceof Map ? (directory.get(key) ?? null) : (directory[key] ?? null);
}

/** First name only, honorific stripped, for the "About <first name>" disclosure. */
function firstName(name: string): string {
  return name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/)[0] || name;
}

export function TeamList({
  team,
  directory,
  heading = "Your team",
}: {
  team: TeamMember[];
  directory?: TeamDirectory;
  /** Pass null to render just the grid — e.g. when a caller already put its own "Your team"
   *  heading above (and a PrimaryContact) and doesn't want it duplicated. */
  heading?: string | null;
}) {
  if (team.length === 0) return null;
  const grid = (
      <ul className="grid gap-4 sm:grid-cols-2">
        {team.map((member, i) => {
          const match = lookup(directory, member.name);
          return (
            <li key={`${member.role}-${i}`} className="rounded-2xl border border-line p-5">
              <div className="flex items-start gap-3">
                {match?.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- public atmospherepress.com photo, not worth next/image config
                  <img
                    src={match.photoUrl}
                    alt=""
                    loading="lazy"
                    width={56}
                    height={56}
                    className="h-14 w-14 shrink-0 rounded-full object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">{member.role}</p>
                  <p className="mt-1 font-bold text-ink">{member.name}</p>
                  {match?.title ? <p className="text-sm text-muted">{match.title}</p> : null}
                  <p className="mt-1 text-sm text-muted">
                    {[member.assignedAt ? `Since ${formatDate(member.assignedAt)}` : null, member.status].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              {match?.whatIDo ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-teal">About {firstName(member.name)}</summary>
                  <p className="mt-2 text-sm text-ink-2">{match.whatIDo}</p>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
  );

  if (heading === null) return grid;
  return (
    <section className="mt-12">
      <h2 className="eyebrow">{heading}</h2>
      <div className="mt-4">{grid}</div>
    </section>
  );
}

/**
 * Convenience wrapper that fetches the directory itself, so wiring it into a page is a one-line
 * swap from `<TeamList team={...} />`.
 */
export async function TeamListWithDirectory({
  team,
  heading,
}: {
  team: TeamMember[];
  heading?: string | null;
}) {
  const directory = await getTeamDirectory();
  return <TeamList team={team} directory={directory} heading={heading} />;
}
