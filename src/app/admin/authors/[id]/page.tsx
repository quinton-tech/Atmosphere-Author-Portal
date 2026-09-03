import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookForUser, listBooksForUser } from "@/lib/data/books";
import { getAuthorSummary } from "../queries";
import { getBookRowForAuthor, listNotesForBook } from "./queries";
import { refreshFromHubspotAction } from "./actions";
import { PageHeader, Badge, FormError, FormSuccess, PillButton, PillLink, Card } from "../../_components/ui";
import { fmtDateTime, relativeTime } from "../../_lib/format";
import { PropertiesTable } from "./PropertiesTable";
import { NotesPanel } from "./NotesPanel";
import { DrivePanel } from "./DrivePanel";

export default async function AuthorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ bookId?: string; driveQuery?: string; ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [user, bookSummaries] = await Promise.all([getAuthorSummary(id), listBooksForUser(id)]);
  if (!user) notFound();

  const selectedBookId = sp.bookId ?? bookSummaries[0]?.id ?? null;
  const [book, bookRow] = selectedBookId
    ? await Promise.all([getBookForUser(id, selectedBookId, { includeProperties: true }), getBookRowForAuthor(id, selectedBookId)])
    : [null, null];
  const noteRows = selectedBookId ? await listNotesForBook(selectedBookId) : [];

  return (
    <div>
      <PageHeader
        title={user.name || user.email}
        subtitle={user.email}
        action={
          <div className="flex items-center gap-2">
            {user.disabledAt ? <Badge tone="bad">Disabled</Badge> : <Badge tone="ok">Active</Badge>}
            <PillLink href="/admin/authors">← All authors</PillLink>
          </div>
        }
      />

      <div className="mb-6 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="eyebrow">Role</p>
          <p className="text-sm text-ink">{user.role}</p>
        </Card>
        <Card>
          <p className="eyebrow">Last login</p>
          <p className="text-sm text-ink">{relativeTime(user.lastLoginAt)}</p>
        </Card>
        <Card>
          <p className="eyebrow">Invited</p>
          <p className="text-sm text-ink">{user.invitedAt ? fmtDateTime(user.invitedAt) : "Not invited"}</p>
        </Card>
        <Card>
          <p className="eyebrow">HubSpot contact</p>
          <p className="truncate text-sm text-ink">{user.hubspotContactId ?? "—"}</p>
        </Card>
      </div>

      {bookSummaries.length === 0 ? (
        <p className="text-sm text-muted">No books synced for this author yet.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {bookSummaries.map((b) => (
              <Link
                key={b.id}
                href={`/admin/authors/${id}?bookId=${b.id}`}
                className={`eyebrow rounded-full border px-3 py-1.5 tracking-normal normal-case text-[13px] ${
                  b.id === selectedBookId ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-ink-2"
                }`}
              >
                {b.title} — {b.stageLabel}
              </Link>
            ))}
            <form action={refreshFromHubspotAction.bind(null, id)}>
              <PillButton>Refresh from HubSpot</PillButton>
            </form>
          </div>

          {book ? (
            <div className="space-y-8">
              <section>
                <h2 className="eyebrow mb-2">Raw cached properties</h2>
                <PropertiesTable properties={book.properties ?? {}} />
                <p className="mt-1 text-xs text-muted">Synced {book.syncedAt ? fmtDateTime(book.syncedAt) : "never"}.</p>
              </section>

              <section>
                <h2 className="eyebrow mb-2">Notes</h2>
                <NotesPanel userId={id} bookId={book.id} notes={noteRows} />
              </section>

              <section>
                <h2 className="eyebrow mb-2">Google Drive</h2>
                <DrivePanel userId={id} bookId={book.id} driveFolderId={bookRow?.driveFolderId ?? null} searchQuery={sp.driveQuery} />
              </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
