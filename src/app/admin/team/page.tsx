import Link from "next/link";
import { listTeamMembers, getLastImportedAt } from "./queries";
import { importTeamAction, toggleShowAction, toggleLockAction, editTeamMemberAction } from "./actions";
import { PageHeader, Table, Th, Td, Badge, FormError, FormSuccess, Pagination, PillButton } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const [{ rows, nextCursor }, lastImportedAt] = await Promise.all([listTeamMembers({ cursor: sp.cursor }), getLastImportedAt()]);
  const nextHref = `/admin/team?${new URLSearchParams({ cursor: nextCursor ?? "" }).toString()}`;

  return (
    <div>
      <PageHeader
        title="Team directory"
        subtitle="Imported from the atmospherepress.com Our Team page. Shown to authors as a photo, title, and short bio next to their assigned team member. Edited fields lock and survive re-import."
        action={
          <form action={importTeamAction}>
            <PillButton variant="solid">Import from atmospherepress.com</PillButton>
          </form>
        }
      />

      <div className="mb-4 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      <p className="mb-4 text-sm text-muted">
        Last import: {lastImportedAt ? fmtDateTime(lastImportedAt) : "never"}. 50 per page.
      </p>

      <Table>
        <thead>
          <tr>
            <Th>Photo</Th>
            <Th>Name</Th>
            <Th>Title</Th>
            <Th>Departments</Th>
            <Th>What I do for authors</Th>
            <Th>Visible</Th>
            <Th>Locked</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <Td>
                {m.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- public atmospherepress.com photo
                  <img src={m.photoUrl} alt="" loading="lazy" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
              <Td className="font-semibold text-ink">{m.name}</Td>
              <Td colSpan={4}>
                <form action={editTeamMemberAction} className="grid grid-cols-12 items-start gap-2">
                  <input type="hidden" name="id" value={m.id} />
                  <input
                    name="title"
                    defaultValue={m.title ?? ""}
                    placeholder="Title"
                    className="col-span-3 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                  />
                  <span className="col-span-3 self-center text-xs text-muted">{m.departments.join(", ") || "—"}</span>
                  <textarea
                    name="whatIDo"
                    defaultValue={m.whatIDo ?? ""}
                    placeholder="What I do for authors"
                    rows={2}
                    className="col-span-6 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                  />
                  <div className="col-span-12 mt-1">
                    <PillButton>Save</PillButton>
                  </div>
                </form>
              </Td>
              <Td>
                <form action={toggleShowAction.bind(null, m.id)}>
                  <PillButton variant={m.showToAuthors ? "solid" : "ghost"}>{m.showToAuthors ? "Shown" : "Hidden"}</PillButton>
                </form>
              </Td>
              <Td>
                <form action={toggleLockAction.bind(null, m.id)}>
                  <PillButton variant={m.locked ? "danger" : "ghost"}>{m.locked ? "Locked" : "Unlocked"}</PillButton>
                </form>
              </Td>
              <Td>{m.locked ? <Badge tone="warn">Edited</Badge> : null}</Td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={8} className="text-muted">
                No team members imported yet.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>

      <Pagination hasMore={!!nextCursor} nextHref={nextHref} />

      <p className="mt-4 text-xs text-muted">
        Full profiles at{" "}
        <Link href="https://atmospherepress.com/our-team" target="_blank" rel="noreferrer" className="underline">
          atmospherepress.com/our-team
        </Link>
        .
      </p>
    </div>
  );
}
