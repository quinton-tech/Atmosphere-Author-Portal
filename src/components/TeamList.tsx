import type { TeamMember } from "@/lib/types";
import { formatDate } from "./format";

export function TeamList({ team }: { team: TeamMember[] }) {
  if (team.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="eyebrow">Your team</h2>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {team.map((member, i) => (
          <li key={`${member.role}-${i}`} className="rounded-2xl border border-line p-5">
            <p className="eyebrow">{member.role}</p>
            <p className="mt-1 font-bold text-ink">{member.name}</p>
            <p className="mt-1 text-sm text-muted">
              {[member.assignedAt ? `Since ${formatDate(member.assignedAt)}` : null, member.status].filter(Boolean).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
