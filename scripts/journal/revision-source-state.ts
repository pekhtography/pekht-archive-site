export type SourceCatalogItem = {
  source_id: string;
  title: string;
  hashtags: string[];
};

export type SourceRequestStatus =
  | "NOT_IN_SNAPSHOT"
  | "SOURCE_MAP_MISSING"
  | "ALREADY_INCLUDED"
  | "ALREADY_REQUESTED"
  | "ALREADY_REJECTED"
  | "LIMIT_EXCEEDED"
  | "DUPLICATE_REQUEST";

export type SourceRequestResult = {
  accepted_source_ids: string[];
  rejected: Array<{ source_id: string; status: SourceRequestStatus }>;
};

export type RevisionSourceState = {
  included_source_ids: Set<string>;
  requested_source_ids: Set<string>;
  accepted_source_ids: Set<string>;
  rejected_source_ids: Set<string>;
  deferred_source_ids: string[];
  deferred_initialized: boolean;
  deferred_rejections: Array<{ source_id: string; status: SourceRequestStatus }>;
};

export function createRevisionSourceState(includedSourceIds: string[]): RevisionSourceState {
  return {
    included_source_ids: new Set(includedSourceIds),
    requested_source_ids: new Set(),
    accepted_source_ids: new Set(),
    rejected_source_ids: new Set(),
    deferred_source_ids: [],
    deferred_initialized: false,
    deferred_rejections: [],
  };
}

export function buildSourceCatalog(items: SourceCatalogItem[]): string {
  return items.map((item) => [
    `SOURCE_ID: ${item.source_id}`,
    `TITLE: ${item.title}`,
    `HASHTAGS: ${item.hashtags.join(" ")}`,
  ].join("\n")).join("\n\n---\n\n");
}

export function initializeDeferredSourceIds(
  proposedIds: unknown,
  catalogIds: ReadonlySet<string>,
  snapshotIds: ReadonlySet<string>,
  sourceMap: ReadonlyMap<string, unknown>,
  state: RevisionSourceState,
): string[] {
  if (state.deferred_initialized) return [...state.deferred_source_ids];
  state.deferred_initialized = true;
  if (!Array.isArray(proposedIds)) return [];
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const raw of proposedIds) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    let status: SourceRequestStatus | null = null;
    if (seen.has(raw)) status = "DUPLICATE_REQUEST";
    else if (!catalogIds.has(raw) || !snapshotIds.has(raw)) status = "NOT_IN_SNAPSHOT";
    else if (!sourceMap.has(raw)) status = "SOURCE_MAP_MISSING";
    else if (state.included_source_ids.has(raw)) status = "ALREADY_INCLUDED";
    else if (state.requested_source_ids.has(raw) || state.accepted_source_ids.has(raw)) status = "ALREADY_REQUESTED";
    else if (state.rejected_source_ids.has(raw)) status = "ALREADY_REJECTED";
    else if (accepted.length >= 3) status = "LIMIT_EXCEEDED";
    seen.add(raw);
    if (status) {
      state.deferred_rejections.push({ source_id: raw, status });
      if (status === "SOURCE_MAP_MISSING") throw new Error(`SOURCE_MAP_MISSING: deferred source_id=${raw} exists in catalog/snapshot but is missing from sourceMap.`);
      if (status !== "DUPLICATE_REQUEST") state.rejected_source_ids.add(raw);
      continue;
    }
    accepted.push(raw);
  }
  state.deferred_source_ids = accepted;
  return [...accepted];
}

export function resolveAdditionalSourceRequests(args: {
  requestedIds: unknown;
  allowedIds: ReadonlySet<string>;
  snapshotIds: ReadonlySet<string>;
  sourceMap: ReadonlyMap<string, unknown>;
  state: RevisionSourceState;
  limit?: number;
}): SourceRequestResult {
  const { requestedIds, allowedIds, snapshotIds, sourceMap, state } = args;
  const limit = args.limit ?? 3;
  const result: SourceRequestResult = { accepted_source_ids: [], rejected: [] };
  if (!Array.isArray(requestedIds)) return result;
  const seen = new Set<string>();
  for (const raw of requestedIds) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const id = raw;
    let status: SourceRequestStatus | null = null;
    if (seen.has(id)) status = "DUPLICATE_REQUEST";
    else if (state.included_source_ids.has(id)) status = "ALREADY_INCLUDED";
    else if (state.requested_source_ids.has(id) || state.accepted_source_ids.has(id)) status = "ALREADY_REQUESTED";
    else if (state.rejected_source_ids.has(id)) status = "ALREADY_REJECTED";
    else if (!snapshotIds.has(id) || !allowedIds.has(id)) status = "NOT_IN_SNAPSHOT";
    else if (!sourceMap.has(id)) status = "SOURCE_MAP_MISSING";
    else if (result.accepted_source_ids.length >= limit) status = "LIMIT_EXCEEDED";

    seen.add(id);
    if (status) {
      result.rejected.push({ source_id: id, status });
      if (status === "SOURCE_MAP_MISSING") {
        throw new Error(`SOURCE_MAP_MISSING: source_id=${id} exists in snapshot/catalog but is missing from sourceMap.`);
      }
      if (status !== "DUPLICATE_REQUEST") state.rejected_source_ids.add(id);
      continue;
    }
    result.accepted_source_ids.push(id);
    state.requested_source_ids.add(id);
    state.accepted_source_ids.add(id);
  }
  return result;
}

export function serializeRevisionSourceState(state: RevisionSourceState, revisionAttempt: number) {
  return {
    included_source_ids: [...state.included_source_ids],
    requested_source_ids: [...state.requested_source_ids],
    accepted_source_ids: [...state.accepted_source_ids],
    rejected_source_ids: [...state.rejected_source_ids],
    deferred_source_ids: [...state.deferred_source_ids],
    deferred_rejections: [...state.deferred_rejections],
    revision_attempt: revisionAttempt,
  };
}
