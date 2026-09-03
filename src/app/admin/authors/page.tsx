import Link from "next/link";
import { listAuthors } from "./queries";
import { inviteRowAction, resendInviteAction, revokeAccessAction, forceSignOutAction, viewAsAction } from "./actions";
import { InviteForm } from "./InviteForm";
import { PageHeader, Table, Th, Td, Badge, FormError, FormSuccess, Pagination, PillButton } from "../_components/ui";
import { fmtDate, relativeTime } from "../_lib/format";

export default async function AuthorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { rows, nextCursor } = await listAuthors({ q: sp.q, cursor: sp.cursor });
  const nextHref = `/admin/authors?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), cursor: nextCursor ?? "" }).toString()}`;

  return (
    <div>
      <PageHeader title="Authors" subtitle="Search across name, email, and book title. 50 per page." />

      <div className="mb-4 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      <InviteForm />

      <form className="mb-4 flex gap-2" action="/admin/authors">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search name, email, or book title…"
          className="w-80 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
        />
        <PillButton variant="ghost" type="submit">
          Search
        </PillButton>
        {sp.q ? (
          <Link href="/admin/authors" className="eyebrow self-center text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Books &amp; stage</Th>
            <Th>Last login</Th>
            <Th>Invited</Th>
            <Th>Status</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <Td>
                <Link href={`/admin/authors/${u.id}`} className="font-semibold text-ink hover:text-teal-ink">
                  {u.name || "—"}
                </Link>
              </Td>
              <Td>{u.email}</Td>
              <Td>
                {u.books.length === 0 ? (
                  <span className="text-muted">No books</span>
                ) : (
                  <ul className="space-y-0.5">
                    {u.books.map((b) => (
                      <li key={b.id}>
                        {b.title} <span className="text-muted">— {b.stageLabel}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Td>
              <Td>{relativeTime(u.lastLoginAt)}</Td>
              <Td>{u.invitedAt ? fmtDate(u.invitedAt) : <Badge>Not invited</Badge>}</Td>
              <Td>{u.disabledAt ? <Badge tone="bad">Disabled</Badge> : <Badge tone="ok">Active</Badge>}</Td>
              <Td>
                <div className="flex flex-wrap gap-1.5">
                  {!u.invitedAt ? (
                    <form action={inviteRowAction.bind(null, u.id)}>
                      <PillButton>Invite</PillButton>
                    </form>
                  ) : (
                    <form action={resendInviteAction.bind(null, u.id)}>
                      <PillButton>Resend</PillButton>
                    </form>
                  )}
                  <form action={revokeAccessAction.bind(null, u.id)}>
                    <PillButton variant="danger">Revoke</PillButton>
                  </form>
                  <form action={forceSignOutAction.bind(null, u.id)}>
                    <PillButton>Force sign-out</PillButton>
                  </form>
                  {u.role === "author" ? (
                    <form action={viewAsAction.bind(null, u.id)}>
                      <PillButton>View as</PillButton>
                    </form>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={7} className="text-muted">
                <span>No authors match.</span>
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>

      <Pagination hasMore={!!nextCursor} nextHref={nextHref} />
    </div>
  );
}
