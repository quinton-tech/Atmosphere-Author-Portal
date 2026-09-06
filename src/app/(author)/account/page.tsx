import { cn } from "@/components/cn";
import { SubmitButton } from "@/components/SubmitButton";
import { getAuthorProfile } from "@/lib/data/profile";
import { hasPasswordHash, PASSWORD_RULES_TEXT } from "@/lib/auth/password";
import { effectiveUserId, requireUser } from "@/lib/session";
import { setPasswordAction, signOutEverywhereAction, updateContactInfoAction } from "./actions";

const CONTACT_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: "Saved. Our team will see the update within a few minutes." },
  error: { ok: false, text: "We couldn't save that just now. Please try again, or email your main contact." },
  // The redirect only carries a general "invalid" code (no per-field detail), so we can highlight
  // the section but not a specific input — see the report to the lead on this limitation.
  invalid: { ok: false, text: "Please check the highlighted fields and try again." },
};

/** `?password=<code>` -> banner copy plus which field(s) it's about, matching the codes documented
 *  on `setPasswordAction` in `./actions.ts`: invalid | mismatch | wrong_current | reauth | weak | error | ok. */
const PASSWORD_MESSAGES: Record<string, { ok: boolean; text: string; fields?: string[] }> = {
  ok: { ok: true, text: "Password updated." },
  invalid: { ok: false, text: "Please fill in both password fields.", fields: ["newPassword", "confirmPassword"] },
  mismatch: { ok: false, text: "Those passwords don't match.", fields: ["confirmPassword"] },
  wrong_current: { ok: false, text: "Your current password wasn't correct.", fields: ["currentPassword"] },
  reauth: {
    ok: false,
    text: "For your security, please sign out and sign in again before setting a password.",
  },
  weak: {
    ok: false,
    text: "Choose a stronger password — it needs to be longer, or isn't one we can use because it's appeared in a known data breach.",
    fields: ["newPassword"],
  },
  error: { ok: false, text: "We couldn't update your password just now. Please try again." },
};

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  autoComplete,
  invalid = false,
  errorText,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  autoComplete?: string;
  invalid?: boolean;
  errorText?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete ?? (type === "password" ? "new-password" : "on")}
        aria-invalid={invalid ? true : undefined}
        className={cn(
          "mt-2 w-full rounded-xl border bg-bg px-3 py-2 text-ink",
          invalid ? "border-coral" : "border-line",
        )}
      />
      {invalid && errorText && <p className="mt-1 text-sm font-semibold text-coral-ink">{errorText}</p>}
    </label>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    contact?: string;
    password?: string;
    // Echoed back on a contact-save error so the author doesn't lose what they typed (see the
    // report to the lead: `updateContactInfoAction` doesn't append these yet, so until it does
    // these will simply be absent and the form falls back to the saved profile values below).
    phone?: string;
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  }>;
}) {
  const user = await requireUser();
  const userId = effectiveUserId(user);
  // Contact info now comes from `getAuthorProfile` (the `users` row, kept current by
  // `updateAuthorContactInfo`) rather than `getAuthorInfoForUser`'s book-cache snapshot, which a
  // later Project sync can silently overwrite — see the doc comment on `getAuthorProfile`.
  const [info, hasPassword, sp] = await Promise.all([getAuthorProfile(userId), hasPasswordHash(user.id), searchParams]);
  const { contact, password } = sp;
  const contactMsg = contact ? CONTACT_MESSAGES[contact] : null;
  const passwordMsg = password ? PASSWORD_MESSAGES[password] : null;
  const passwordFields = new Set(passwordMsg?.fields ?? []);

  return (
    <div className="max-w-[72ch] pb-16">
      <h1 className="text-3xl font-extrabold text-ink">Account</h1>

      <section className="mt-10">
        <h2 className="eyebrow">Email</h2>
        <p className="mt-2 text-ink">{user.email}</p>
        <p className="mt-1 text-sm text-muted">To change your email, ask your main contact.</p>
      </section>

      <section className="mt-10">
        <h2 className="eyebrow">Contact details</h2>
        {contactMsg && (
          <p className={`mt-3 text-sm font-semibold ${contactMsg.ok ? "text-teal-ink" : "text-coral-ink"}`}>
            {contactMsg.text}
          </p>
        )}
        <form action={updateContactInfoAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Phone" name="phone" defaultValue={info?.phone ?? ""} invalid={contact === "invalid" && invalidField === "phone"} />
          <Field label="Street" name="street" defaultValue={info?.street ?? ""} invalid={contact === "invalid" && invalidField === "street"} />
          <Field label="City" name="city" defaultValue={info?.city ?? ""} invalid={contact === "invalid" && invalidField === "city"} />
          <Field
            label="State / region"
            name="region"
            defaultValue={sp.region ?? info?.region ?? ""}
            invalid={contact === "invalid"}
          />
          <Field
            label="Postal code"
            name="postalCode"
            defaultValue={sp.postalCode ?? info?.postalCode ?? ""}
            invalid={contact === "invalid"}
          />
          <Field
            label="Country"
            name="country"
            defaultValue={sp.country ?? info?.country ?? ""}
            invalid={contact === "invalid"}
          />
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Saving…">Save contact details</SubmitButton>
          </div>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="eyebrow">Password</h2>
        {passwordMsg && (
          <p className={`mt-3 text-sm font-semibold ${passwordMsg.ok ? "text-teal-ink" : "text-coral-ink"}`}>
            {passwordMsg.text}
          </p>
        )}
        <p className="mt-3 text-sm text-muted">{PASSWORD_RULES_TEXT}</p>
        <form action={setPasswordAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          {hasPassword && (
            <div className="sm:col-span-2">
              <Field
                label="Current password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                invalid={passwordFields.has("currentPassword")}
                errorText={passwordMsg?.text}
              />
            </div>
          )}
          <Field
            label="New password"
            name="newPassword"
            type="password"
            invalid={passwordFields.has("newPassword")}
            errorText={passwordMsg?.text}
          />
          <Field
            label="Confirm new password"
            name="confirmPassword"
            type="password"
            invalid={passwordFields.has("confirmPassword")}
            errorText={passwordMsg?.text}
          />
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Updating…">Update password</SubmitButton>
          </div>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="eyebrow">Sessions</h2>
        <p className="mt-2 text-ink-2">Sign out of the portal on every device you&rsquo;ve used.</p>
        <form action={signOutEverywhereAction} className="mt-4">
          <SubmitButton variant="outline" pendingText="Signing out…">
            Sign out everywhere
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
