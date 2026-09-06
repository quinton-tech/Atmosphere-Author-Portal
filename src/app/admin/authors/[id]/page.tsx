import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookForUser, listBooksForUser } from "@/lib/data/books";
import { getAuthorSummary } from "../queries";
import { getBookRowForAuthor, getWebsiteEditOverride, listNotesForBook } from "./queries";
import { refreshFromHubspotAction, setWebsiteEditOverrideAction } from "./actions";
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
  const websiteEditOverride = selectedBookId ? await getWebsiteEditOverride(selectedBookId) : null;

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

              {book.website ? (
                <section>
                  <h2 className="eyebrow mb-2">Author website</h2>
                  <Card>
                    <p className="mb-3 text-sm text-ink-2">
                      The &ldquo;Edit your site&rdquo; link normally guesses <code>&lt;site origin&gt;/wp-admin/</code> from the
                      website URL. Set an override here if that guess is wrong for this book.
                    </p>
                    <form action={setWebsiteEditOverrideAction.bind(null, id, book.id)} className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-1 min-w-[260px] flex-col gap-1">
                        <label htmlFor="editUrl" className="eyebrow">
                          Website edit URL override
                        </label>
                        <input
                          id="editUrl"
                          name="editUrl"
                          type="url"
                          placeholder="https://example.com/wp-admin/"
                          defaultValue={websiteEditOverride ?? ""}
                          className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
                        />
                      </div>
                      <PillButton variant="solid">Save</PillButton>
                    </form>
                  </Card>
                </section>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
