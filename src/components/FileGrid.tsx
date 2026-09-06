import type { FileView } from "@/lib/types";
import { Thumb } from "@/components/Thumb";
import { EmptyState } from "./EmptyState";

function shortKind(mimeType: string | null): string {
  if (!mimeType) return "File";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("word")) return "DOCX";
  if (mimeType.includes("sheet")) return "XLSX";
  if (mimeType.includes("presentation")) return "PPTX";
  return "File";
}

/** Grouped by category. Thumbnails and downloads always route through the portal's file proxy. */
export function FileGrid({ files }: { files: FileView[] }) {
  if (files.length === 0) {
    return <EmptyState title="Nothing shared yet." message="Check back soon or email your Author Manager." />;
  }

  const groups = new Map<string, FileView[]>();
  for (const file of files) {
    const list = groups.get(file.category) ?? [];
    list.push(file);
    groups.set(file.category, list);
  }

  return (
    <div className="space-y-12">
      {[...groups.entries()].map(([category, items]) => (
        <section key={category}>
          <h2 className="eyebrow">{category}</h2>
          <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((file) => (
              <li key={file.id} className="overflow-hidden rounded-2xl border border-line">
                {file.thumbnailHref ? (
                  <Thumb src={file.thumbnailHref} fallback={shortKind(file.mimeType)} />
                ) : (
                  <div className="eyebrow flex h-32 w-full items-center justify-center bg-surface text-muted">
                    {shortKind(file.mimeType)}
                  </div>
                )}
                <div className="p-4">
                  <p className="truncate font-semibold text-ink">{file.label}</p>
                  <div className="mt-3 flex gap-3 text-sm">
                    <a href={file.href} className="rounded-full border border-line px-3 py-1 font-semibold text-ink">
                      Open
                    </a>
                    <a
                      href={`${file.href}?download=1`}
                      className="rounded-full border border-line px-3 py-1 font-semibold text-ink"
                    >
                      Download
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
