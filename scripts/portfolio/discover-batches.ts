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

export interface DiscoveryPostText {
  source_id: string;
  body: string;
}

export interface DiscoveryQuoteIssue {
  code: "DISCOVERY_EVIDENCE_QUOTE_NOT_FOUND";
  message: string;
}

/**
 * Verifies every BODY evidence quote against the exact BODY text belonging
 * to that publication. A structurally valid quote is not sufficient unless
 * it is a literal contiguous substring of the source publication.
 */
export function validateDiscoveryEvidenceQuotes(
  records: Array<{ source_id: string; observations?: unknown }>,
  posts: DiscoveryPostText[],
): DiscoveryQuoteIssue[] {
  const bodyById = new Map(posts.map((post) => [post.source_id, post.body]));
  const issues: DiscoveryQuoteIssue[] = [];

  for (const record of records) {
    if (!record || typeof record !== "object" || typeof record.source_id !== "string") continue;
    const body = bodyById.get(record.source_id);
    if (typeof body !== "string" || !Array.isArray(record.observations)) continue;

    for (const [observationIndex, observation] of record.observations.entries()) {
      if (!observation || typeof observation !== "object") continue;
      const evidence = (observation as { evidence?: unknown }).evidence;
      if (!Array.isArray(evidence)) continue;

      for (const [evidenceIndex, item] of evidence.entries()) {
        if (!item || typeof item !== "object") continue;
        const quote = (item as { quote?: unknown }).quote;
        const source = (item as { source?: unknown }).source;
        if (source === "BODY" && typeof quote === "string" && quote.length > 0 && !body.includes(quote)) {
          issues.push({
            code: "DISCOVERY_EVIDENCE_QUOTE_NOT_FOUND",
            message: `Evidence quote is not an exact contiguous BODY substring at ${record.source_id}:${observationIndex}:${evidenceIndex}.`
          });
        }
      }
    }
  }

  return issues;
}

export function selectBatchesToProcess<T>(batches: T[][], reusableSuccessIndexes: number[]): T[][] {
  const reusable = new Set(reusableSuccessIndexes);
  if (reusable.size !== reusableSuccessIndexes.length ||
      [...reusable].some((index) => !Number.isInteger(index) || index < 1 || index > batches.length)) {
    throw new Error("Reusable batch indexes must be unique, valid 1-based batch indexes.");
  }
  return batches.filter((_, index) => !reusable.has(index + 1));
}

export function mapDiscoverySourceIndexes(
  records: Array<{ source_index?: unknown; [key: string]: unknown }>,
  batch: Array<{ source_id: string }>,
): Array<{ source_id: string; [key: string]: unknown }> {
  return records.map((record) => {
    const { source_index, ...discoveryFields } = record;
    const sourceId = Number.isInteger(source_index) &&
      (source_index as number) >= 0 &&
      (source_index as number) < batch.length
      ? String(batch[source_index as number].source_id)
      : "";
    return { ...discoveryFields, source_id: sourceId };
  });
}

export function buildDiscoveryResponseSchema() {
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
          required: ["source_index", "result", "observations"],
          properties: {
            source_index: { type: "integer" },
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
