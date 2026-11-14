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

export function selectBatchesToProcess<T>(batches: T[][], reusableSuccessIndexes: number[]): T[][] {
  const reusable = new Set(reusableSuccessIndexes);
  if (reusable.size !== reusableSuccessIndexes.length ||
      [...reusable].some((index) => !Number.isInteger(index) || index < 1 || index > batches.length)) {
    throw new Error("Reusable batch indexes must be unique, valid 1-based batch indexes.");
  }
  return batches.filter((_, index) => !reusable.has(index + 1));
}

export function buildDiscoveryResponseSchema(sourceIds: string[]) {
  if (sourceIds.length !== 100 || new Set(sourceIds).size !== 100 || sourceIds.some((id) => !id)) {
    throw new Error("DISCOVER response schema requires exactly 100 unique non-empty source IDs.");
  }
  return {
    type: "object",
    required: ["records"],
    properties: {
      records: {
        type: "array",
        minItems: 100,
        maxItems: 100,
        items: {
          type: "object",
          required: ["source_id", "result", "observations"],
          properties: {
            source_id: { type: "string", enum: sourceIds },
            result: { type: "string", enum: ["SIGNALS_FOUND", "NO_SIGNAL"] },
            observations: {
              type: "array",
              items: {
                type: "object",
                required: ["prism", "signal", "interpretation", "evidence"],
                properties: {
                  prism: { type: "string" },
                  signal: { type: "string" },
                  interpretation: { type: "string" },
                  evidence: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["source", "quote"],
                      properties: {
                        source: { type: "string", enum: ["BODY"] },
                        quote: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}
