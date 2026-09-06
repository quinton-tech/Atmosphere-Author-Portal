import { listHandbookVersions } from "./queries";
import { activateHandbookAction } from "./actions";
import { FallbackUploadForm } from "./UploadForm";
import { UploadFormClient } from "./UploadFormClient";
import { TestQuestionForm } from "./TestQuestionForm";
import { PageHeader, Badge, FormError, FormSuccess, PillButton, Table, Th, Td } from "../_components/ui";
import { fmtDateTime } from "../_lib/format";
import { isUploadsConfigured } from "@/lib/env";

export default async function HandbookPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const versions = await listHandbookVersions();

  return (
    <div>
      <PageHeader title="Handbook" subtitle="The Author Handbook grounds the assistant's answers. Only one version is active at a time." />

      <div className="mb-6 space-y-2">
        <FormError message={sp.error} />
        <FormSuccess message={sp.ok} />
      </div>

      {isUploadsConfigured() ? <UploadFormClient /> : <FallbackUploadForm />}

      <section className="mb-8">
        <p className="eyebrow mb-2">Versions</p>
        <Table>
          <thead>
            <tr>
              <Th>File</Th>
              <Th>Uploaded</Th>
              <Th>Sections</Th>
              <Th>Tokens (est.)</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <Td>{v.filename}</Td>
                <Td>{fmtDateTime(v.createdAt)}</Td>
                <Td>{v.sectionCount}</Td>
                <Td className="tabular">{v.tokenEstimate.toLocaleString()}</Td>
                <Td>{v.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td>
                  {!v.isActive ? (
                    <form action={activateHandbookAction.bind(null, v.id)}>
                      <PillButton>Make active</PillButton>
                    </form>
                  ) : null}
                </Td>
              </tr>
            ))}
            {versions.length === 0 ? (
              <tr>
                <Td colSpan={6} className="text-muted">
                  No handbook uploaded yet.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </section>

      <section>
        <p className="eyebrow mb-2">Test a question</p>
        <TestQuestionForm versions={versions.map((v) => ({ id: v.id, filename: v.filename, isActive: v.isActive }))} />
      </section>
    </div>
  );
}
