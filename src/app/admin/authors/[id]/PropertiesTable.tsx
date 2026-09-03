import { Table, Th, Td } from "../../_components/ui";

export function PropertiesTable({ properties }: { properties: Record<string, string | null> }) {
  const entries = Object.entries(properties).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <p className="text-sm text-muted">No cached properties yet. Try Refresh from HubSpot.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-64">Portal property</Th>
          <Th>Raw value</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key}>
            <Td className="font-mono text-xs text-ink">{key}</Td>
            <Td>{value ?? <span className="text-muted">—</span>}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
