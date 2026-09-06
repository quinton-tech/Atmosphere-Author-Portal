import type { PrimaryContact as PrimaryContactView } from "@/lib/types";

/** First name only, honorific stripped, for the "Email <first name>" button. */
function firstName(name: string): string {
  return name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/)[0] || name;
}

/**
 * The one person the author should reach out to, made unmistakable: a photo, their role, what
 * they handle, and a one-tap way to email them. Shown above the wider team list.
 */
export function PrimaryContact({ contact }: { contact: PrimaryContactView }) {
  const subtitle =
    contact.title && contact.title !== contact.roleLabel ? `${contact.roleLabel} · ${contact.title}` : contact.roleLabel;

  return (
    <div className="rounded-2xl border border-line p-5">
      <p className="eyebrow">Your main contact</p>
      <div className="mt-3 flex items-start gap-4">
        {contact.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public atmospherepress.com photo, not worth next/image config
          <img
            src={contact.photoUrl}
            alt=""
            loading="lazy"
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-ink">{contact.name}</p>
          <p className="text-sm text-muted">{subtitle}</p>
          <p className="mt-2 max-w-[60ch] text-ink-2">{contact.handles}</p>
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="mt-4 inline-block rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg"
            >
              Email {firstName(contact.name)}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
