import Link from "next/link";
import { listBooks } from "./queries";
import { PageHeader, Table, Th, Td, Badge, Pagination, PillButton } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";

export default async function BooksPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const { rows, nextCursor } = await listBooks({ q: sp.q, cursor: sp.cursor });
  const nextHref = `/admin/books?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), cursor: nextCursor ?? "" }).toString()}`;

  return (
    <div>
      <PageHeader title="Books" subtitle="Every book synced from HubSpot. Search by title or author. 50 per page." />

      <form className="mb-4 flex gap-2" action="/admin/books">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search title, author name, or email…"
          className="w-80 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
        />
        <PillButton type="submit">Search</PillButton>
        {sp.q ? (
          <Link href="/admin/books" className="eyebrow self-center text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      <Table>
        <thead>
          <tr>
            <Th>Title</Th>
            <Th>Author</Th>
            <Th>Stage</Th>
            <Th>Updated</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <Td>
                <Link href={`/admin/authors/${b.userId}?bookId=${b.id}`} className="font-semibold text-ink hover:text-teal-ink">
                  {b.title}
                </Link>
              </Td>
              <Td>
                <Link href={`/admin/authors/${b.userId}`} className="hover:text-teal-ink">
                  {b.authorName || b.authorEmail}
                </Link>
              </Td>
              <Td>{b.stageLabel}</Td>
              <Td>{fmtDateTime(b.updatedAt)}</Td>
              <Td>{b.isArchived ? <Badge>Archived</Badge> : <Badge tone="ok">Active</Badge>}</Td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-muted">
                No books match.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>

      <Pagination hasMore={!!nextCursor} nextHref={nextHref} />
    </div>
  );
}
