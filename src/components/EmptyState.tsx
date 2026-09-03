export function EmptyState({
  title = "We're setting up your book.",
  message = "Check back soon or email your Author Manager.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-8 py-14 text-center">
      <p className="text-lg font-bold text-ink">{title}</p>
      <p className="mt-2 text-ink-2">{message}</p>
    </div>
  );
}
