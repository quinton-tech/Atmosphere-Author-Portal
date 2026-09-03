import { relativeTime } from "./format";

export function LastUpdated({ syncedAt }: { syncedAt: string | null }) {
  if (!syncedAt) return null;
  return <p className="mt-12 text-sm text-muted">Updated {relativeTime(syncedAt)} from our production system.</p>;
}
