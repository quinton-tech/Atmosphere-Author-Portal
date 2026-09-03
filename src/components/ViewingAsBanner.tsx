import { stopViewAs } from "@/app/(author)/actions";

/** Persistent while an admin is viewing as an author. See CLAUDE.md's audit rule for view-as. */
export function ViewingAsBanner({ name, email }: { name: string | null; email: string }) {
  return (
    <div className="bg-coral">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <p className="text-sm font-semibold text-coral-ink">Viewing as {name ?? email}.</p>
        <form action={stopViewAs}>
          <button type="submit" className="rounded-full bg-bg px-4 py-1.5 text-sm font-semibold text-coral-ink">
            Stop
          </button>
        </form>
      </div>
    </div>
  );
}
