import Link from "next/link";
import { listUploadsForAdmin } from "./queries";
import { PageHeader, Table, Th, Td, Pagination, Badge } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "muted"> = {
  stored: "ok",
  demo: "muted",
  failed: "bad",
};

export default async function AdminUploadsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const sp = await searchParams;
  const { rows, nextCursor } = await listUploadsForAdmin({ cursor: sp.cursor });
  const nextHref = `/admin/uploads?cursor=${encodeURIComponent(nextCursor ?? "")}`;

  return (
    <div>
      <PageHeader
        title="Author uploads"
        subtitle="Files authors have sent through the portal, most recent first. Drive is otherwise read-only in this app — see CLAUDE.md."
      />

      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Author</Th>
            <Th>Book</Th>
            <Th>File</Th>
            <Th>Kind</Th>
            <Th>Size</Th>
            <Th>Status</Th>
            <Th>Note</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{fmtDateTime(r.createdAt)}</Td>
              <Td>
                <Link href={`/admin/authors/${r.authorId}`} className="font-semibold text-teal-ink hover:underline">
                  {r.authorName ?? r.authorEmail}
                </Link>
              </Td>
              <Td>{r.bookTitle ?? "—"}</Td>
              <Td>
                {r.driveWebViewLink ? (
                  <a href={r.driveWebViewLink} target="_blank" rel="noreferrer" className="font-semibold text-teal-ink hover:underline">
                    {r.fileName}
                  </a>
                ) : (
                  r.fileName
                )}
              </Td>
              <Td>{r.kind}</Td>
              <Td>{formatBytes(r.sizeBytes)}</Td>
              <Td>
                <Badge tone={STATUS_TONE[r.status] ?? "muted"}>{r.status}</Badge>
              </Td>
              <Td className="max-w-xs truncate" title={r.note ?? undefined}>
                {r.note ?? "—"}
              </Td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={8} className="text-muted">
                No uploads yet.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>

      <Pagination hasMore={!!nextCursor} nextHref={nextHref} />
    </div>
  );
}
