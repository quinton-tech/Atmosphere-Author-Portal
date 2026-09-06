import Link from "next/link";
import { listAvailableModels } from "../_integrations";
import { getAssistantSettings, listChatMessages } from "./queries";
import { saveAssistantSettingsAction } from "./actions";
import { PageHeader, Badge, Card, FormError, FormSuccess, Pagination, PillButton, Table, Th, Td } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";
import { hasPrevPage, trailPop, trailPush } from "../_lib/cursor";

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ rating?: "-1" | "1"; notInHandbook?: string; cursor?: string; trail?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const [models, settings, log] = await Promise.all([
    listAvailableModels(),
    getAssistantSettings(),
    listChatMessages({ rating: sp.rating, notInHandbook: sp.notInHandbook === "1", cursor: sp.cursor }),
  ]);

  const current = settings.provider && settings.model ? `${settings.provider}::${settings.model}` : "";
  const params = new URLSearchParams();
  if (sp.rating) params.set("rating", sp.rating);
  if (sp.notInHandbook) params.set("notInHandbook", sp.notInHandbook);
  params.set("cursor", log.nextCursor ?? "");
  params.set("trail", trailPush(sp.trail, sp.cursor));
  const nextHref = `/admin/assistant?${params.toString()}`;

  let prevHref: string | null = null;
  if (hasPrevPage(sp.trail)) {
    const { cursor: prevCursor, trail: remainingTrail } = trailPop(sp.trail);
    const prevParams = new URLSearchParams();
    if (sp.rating) prevParams.set("rating", sp.rating);
    if (sp.notInHandbook) prevParams.set("notInHandbook", sp.notInHandbook);
    if (prevCursor) prevParams.set("cursor", prevCursor);
    if (remainingTrail) prevParams.set("trail", remainingTrail);
    prevHref = `/admin/assistant?${prevParams.toString()}`;
  }

  return (
    <div>
      <PageHeader title="Assistant" subtitle="Choose the model that answers author questions and review recent conversations." />

      <div className="mb-6 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      <section className="mb-8">
        <p className="eyebrow mb-2">Active model</p>
        {models.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-2">
              No providers configured yet, or the model catalog isn&apos;t wired up.
              {settings.provider ? (
                <>
                  {" "}
                  Currently saved: <strong>{settings.provider}</strong> / <strong>{settings.model}</strong>.
                </>
              ) : null}
            </p>
          </Card>
        ) : (
          <form action={saveAssistantSettingsAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="providerModel" className="eyebrow">
                Provider / model
              </label>
              <select
                id="providerModel"
                name="providerModel"
                defaultValue={current}
                className="w-96 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
              >
                {models.map((m) => (
                  <option key={`${m.provider}::${m.modelId}`} value={`${m.provider}::${m.modelId}`}>
                    {m.provider} — {m.displayName}
                    {m.inputPrice != null ? ` ($${m.inputPrice}/$${m.outputPrice} per 1M)` : ""}
                  </option>
                ))}
              </select>
            </div>
            <PillButton variant="solid">Save</PillButton>
          </form>
        )}
      </section>

      <section>
        <p className="eyebrow mb-2">Chat log</p>
        <div className="mb-3 flex flex-wrap gap-2">
          <FilterLink href="/admin/assistant" active={!sp.rating && !sp.notInHandbook} label="All" />
          <FilterLink href="/admin/assistant?rating=-1" active={sp.rating === "-1"} label="Thumbs down" />
          <FilterLink href="/admin/assistant?notInHandbook=1" active={sp.notInHandbook === "1"} label="Not in handbook" />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Author</Th>
              <Th>Question</Th>
              <Th>Provider / model</Th>
              <Th>Rating</Th>
              <Th>Flags</Th>
            </tr>
          </thead>
          <tbody>
            {log.rows.map((m) => (
              <tr key={m.id} className="cursor-pointer hover:bg-surface">
                <Td className="whitespace-nowrap">
                  <Link href={`/admin/assistant/${m.id}`} className="block text-ink hover:underline">
                    {fmtDateTime(m.createdAt)}
                  </Link>
                </Td>
                <Td>
                  <Link href={`/admin/assistant/${m.id}`} className="block hover:underline">
                    {m.userEmail}
                  </Link>
                </Td>
                <Td className="max-w-md truncate" title={m.question}>
                  <Link href={`/admin/assistant/${m.id}`} className="block hover:underline">
                    {m.question}
                  </Link>
                </Td>
                <Td>
                  {m.provider ?? "—"} {m.model ? `/ ${m.model}` : ""}
                </Td>
                <Td>{m.rating === 1 ? <Badge tone="ok">Up</Badge> : m.rating === -1 ? <Badge tone="bad">Down</Badge> : "—"}</Td>
                <Td>{m.notInHandbook ? <Badge tone="warn">Not in handbook</Badge> : null}</Td>
              </tr>
            ))}
            {log.rows.length === 0 ? (
              <tr>
                <Td colSpan={6} className="text-muted">
                  No chat messages match.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
        <Pagination hasMore={!!log.nextCursor} nextHref={nextHref} prevHref={prevHref} />
      </section>
    </div>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`eyebrow rounded-full border px-3 py-1.5 tracking-normal normal-case text-[13px] ${
        active ? "border-ink bg-ink text-white" : "border-line text-ink-2"
      }`}
    >
      {label}
    </Link>
  );
}
