export type MontageBlock = {
  type: "source" | "bridge";
  source_id?: string;
  text: string;
  [key: string]: unknown;
};

export type MontageValidation =
  | { ok: true; sourceIds: string[]; composition: MontageBlock[] }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deterministic publication-boundary checks for TASK 2 output.
 * This function is pure and can be tested without calling Gemini.
 */
export function validateMontage(
  value: unknown,
  selectedId: string,
  snapshotIds: ReadonlySet<string>,
  sourceImages: ReadonlyMap<string, string>,
): MontageValidation {
  if (!isRecord(value) || value.status !== "OK") {
    return {
      ok: false,
      reason: `MONTAGE_STATUS_INVALID: expected status OK, received ${isRecord(value) && typeof value.status === "string" ? value.status : "<missing-or-invalid>"}.`,
    };
  }

  for (const field of ["title", "description", "markdown"] as const) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      return { ok: false, reason: `MONTAGE_FIELD_INVALID: ${field} must be a non-empty string.` };
    }
  }

  if (value.candidate_id !== selectedId) {
    return {
      ok: false,
      reason: `MONTAGE_CANDIDATE_MISMATCH: expected ${selectedId}, received ${typeof value.candidate_id === "string" && value.candidate_id ? value.candidate_id : "<missing>"}.`,
    };
  }

  if (!Array.isArray(value.facets) || !value.facets.every((facet) => typeof facet === "string" && facet.trim().length > 0)) {
    return { ok: false, reason: "MONTAGE_FACETS_INVALID: facets must be an array of non-empty strings (an empty array is allowed)." };
  }

  if (!Array.isArray(value.source_ids) || !value.source_ids.every((id) => typeof id === "string" && id.trim().length > 0)) {
    return { ok: false, reason: "MONTAGE_SOURCE_IDS_INVALID: source_ids must be an array of non-empty strings." };
  }

  const sourceIds = value.source_ids as string[];
  if (sourceIds.length < 4 || sourceIds.length > 6) {
    return { ok: false, reason: `MONTAGE_SOURCE_COUNT_INVALID: expected 4–6 source posts, received ${sourceIds.length}.` };
  }

  if (new Set(sourceIds).size !== sourceIds.length) {
    return { ok: false, reason: "MONTAGE_DUPLICATE_SOURCE_ID: source_ids contains duplicates." };
  }

  const outsideSnapshot = sourceIds.find((id) => !snapshotIds.has(id));
  if (outsideSnapshot !== undefined) {
    return { ok: false, reason: `MONTAGE_SOURCE_NOT_IN_SNAPSHOT: stage=MONTAGE source_id=${outsideSnapshot} is not in the DISCOVER snapshot.` };
  }

  if (!Array.isArray(value.composition) || value.composition.length === 0) {
    return { ok: false, reason: "MONTAGE_COMPOSITION_INVALID: composition must be a non-empty array." };
  }

  const composition = value.composition as unknown[];
  const compositionSourceIds: string[] = [];
  const seenSourceBlocks = new Set<string>();

  for (let index = 0; index < composition.length; index += 1) {
    const block = composition[index];
    if (!isRecord(block) || (block.type !== "source" && block.type !== "bridge")) {
      return { ok: false, reason: `MONTAGE_BLOCK_TYPE_INVALID: composition block ${index + 1} must be source or bridge.` };
    }

    if (typeof block.text !== "string" || !block.text.trim()) {
      return { ok: false, reason: `MONTAGE_BLOCK_TEXT_INVALID: composition block ${index + 1} has empty text.` };
    }

    if (block.type === "bridge") continue;

    if (typeof block.source_id !== "string" || !block.source_id.trim()) {
      return { ok: false, reason: `MONTAGE_SOURCE_ID_MISSING: source block ${index + 1} has no valid source_id.` };
    }

    const sourceId = block.source_id;
    if (!snapshotIds.has(sourceId)) {
      return { ok: false, reason: `MONTAGE_SOURCE_NOT_IN_SNAPSHOT: stage=MONTAGE composition source_id=${sourceId} is not in the DISCOVER snapshot.` };
    }

    if (seenSourceBlocks.has(sourceId)) {
      return { ok: false, reason: `MONTAGE_DUPLICATE_SOURCE_BLOCK: source_id=${sourceId} appears in multiple source blocks.` };
    }
    seenSourceBlocks.add(sourceId);

    if (typeof sourceImages.get(sourceId) !== "string" || !sourceImages.get(sourceId)?.trim()) {
      return { ok: false, reason: `MONTAGE_SOURCE_IMAGE_MISSING: source_id=${sourceId} has no archive image path.` };
    }

    compositionSourceIds.push(sourceId);
  }

  const declared = new Set(sourceIds);
  const composed = new Set(compositionSourceIds);
  const mismatchedSourceIds = [
    ...[...declared].filter((id) => !composed.has(id)),
    ...[...composed].filter((id) => !declared.has(id)),
  ].sort();
  if (declared.size !== composed.size || mismatchedSourceIds.length > 0) {
    return {
      ok: false,
      reason: `MONTAGE_COMPOSITION_MISMATCH: stage=MONTAGE source_id set differs between task2.source_ids and composition source blocks; mismatched source_id(s): ${mismatchedSourceIds.join(", ") || "<set-size mismatch>"}.`,
    };
  }

  return { ok: true, sourceIds: [...sourceIds], composition: composition as MontageBlock[] };
}
