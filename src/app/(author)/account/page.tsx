import { getAuthorInfoForUser } from "@/lib/data/books";
import { effectiveUserId, requireUser } from "@/lib/session";
import { setPasswordAction, signOutEverywhereAction, updateContactInfoAction } from "./actions";

const CONTACT_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: "Saved. Our team will see the update within a few minutes." },
  error: { ok: false, text: "We couldn't save that just now. Please try again, or email your Author Manager." },
  invalid: { ok: false, text: "Please check the highlighted fields and try again." },
};

const PASSWORD_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: "Password updated." },
  error: { ok: false, text: "We couldn't update your password just now. Please try again." },
  invalid: { ok: false, text: "Use at least 12 characters, and make sure both fields match." },
};

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={type === "password" ? "new-password" : "on"}
        className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-ink"
      />
    </label>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string; password?: string }>;
}) {
  const user = await requireUser();
  const info = await getAuthorInfoForUser(effectiveUserId(user));
  const { contact, password } = await searchParams;
  const contactMsg = contact ? CONTACT_MESSAGES[contact] : null;
  const passwordMsg = password ? PASSWORD_MESSAGES[password] : null;

  return (
    <div className="max-w-[72ch] pb-16">
      <h1 className="text-3xl font-extrabold text-ink">Account</h1>

      <section className="mt-10">
        <h2 className="eyebrow">Email</h2>
        <p className="mt-2 text-ink">{user.email}</p>
        <p className="mt-1 text-sm text-muted">To change your email, contact your Author Manager.</p>
      </section>

      <section className="mt-10">
        <h2 className="eyebrow">Contact details</h2>
        {contactMsg && (
          <p className={`mt-3 text-sm font-semibold ${contactMsg.ok ? "text-teal-ink" : "text-coral-ink"}`}>
            {contactMsg.text}
          </p>
        )}
        <form action={updateContactInfoAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Phone" name="phone" defaultValue={info?.phone ?? ""} />
          <Field label="Street" name="street" defaultValue={info?.street ?? ""} />
          <Field label="City" name="city" defaultValue={info?.city ?? ""} />
          <Field label="State / region" name="region" defaultValue={info?.region ?? ""} />
          <Field label="Postal code" name="postalCode" defaultValue={info?.postalCode ?? ""} />
          <Field label="Country" name="country" defaultValue={info?.country ?? ""} />
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg">
              Save contact details
            </button>
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
        <form action={setPasswordAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="New password" name="newPassword" type="password" />
          <Field label="Confirm new password" name="confirmPassword" type="password" />
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg">
              Update password
            </button>
          </div>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="eyebrow">Sessions</h2>
        <p className="mt-2 text-ink-2">Sign out of the portal on every device you&rsquo;ve used.</p>
        <form action={signOutEverywhereAction} className="mt-4">
          <button type="submit" className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-2">
            Sign out everywhere
          </button>
        </form>
      </section>
    </div>
  );
}
