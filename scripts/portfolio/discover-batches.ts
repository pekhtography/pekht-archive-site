export interface DiscoveryRecordLike {
  source_id: string;
  [key: string]: unknown;
}

export interface DiscoveryCoverage {
  orderedRecords: DiscoveryRecordLike[];
  missingSourceIds: string[];
  unexpectedSourceIds: string[];
  duplicateSourceIds: string[];
}

export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer.");
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    batches.push(items.slice(offset, offset + batchSize));
  }
  return batches;
}

export function inspectDiscoveryCoverage(
  expectedSourceIds: string[],
  records: DiscoveryRecordLike[],
): DiscoveryCoverage {
  const expected = new Set(expectedSourceIds);
  const counts = new Map<string, number>();
  const unexpectedSourceIds: string[] = [];
  for (const record of records) {
    const id = record && typeof record.source_id === "string" ? record.source_id : "";
    if (!expected.has(id)) {
      unexpectedSourceIds.push(id || "[missing-source-id]");
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const duplicateSourceIds = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const missingSourceIds = expectedSourceIds.filter((id) => counts.get(id) !== 1);
  const byId = new Map(records.filter((record) => record && typeof record.source_id === "string").map((record) => [record.source_id, record]));
  return {
    orderedRecords: expectedSourceIds.flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    }),
    missingSourceIds,
    unexpectedSourceIds,
    duplicateSourceIds,
  };
}
