# PEKHTOGRAPHY Journal — Token Budget Optimization (Variant A)

## Status and boundaries

This specification is implemented on an isolated feature branch for review. It does not authorize merging, changing `main`, running Journal, or publishing an article.

## 1. DISCOVER remains unchanged

- DISCOVER receives the complete existing Explore-ordered stratified snapshot, including DATE, TITLE, HASHTAGS and full TEXT.
- The snapshot selection and ordering algorithm are unchanged.
- No excerpts, truncation, or text fragments are introduced.

## 2. SELECT-MONTAGE receives a metadata catalog

The catalog is built from the same sampled DISCOVER snapshot and contains only:

- `SOURCE_ID`
- `TITLE`
- `HASHTAGS`

It contains neither `TEXT/BODY` nor `DATE`.

SELECT-MONTAGE additionally receives the complete text of the 4–6 source IDs selected by DISCOVER. Every source ID returned in the montage must have full text in that request; a catalog-only ID cannot be used in a composition until its full text has been requested and supplied.

## 3. Additional source requests

Additional source requests are made during REVISION, not the initial montage.

- Maximum 3 additional source IDs per REVISION cycle.
- Maximum 2 REVISION cycles.
- Maximum 6 accepted additional source IDs over one candidate's revision flow.
- An accepted request makes the complete archive text available in a subsequent REVISION request; it does not itself add that source to the montage.
- Every ID is checked against both the DISCOVER `snapshotIds` set and the local `sourceMap`.
- A source-map inconsistency is a hard consistency error (`SOURCE_MAP_MISSING`), not a silently ignored partial result.

The request state is local to one Journal run and one candidate. It is not persisted between runs.

## 4. REVISION catalog-once rule

### First REVISION attempt

The first REVISION receives:
- current montage and its full source texts;
- full text for any previously accepted additional sources (normally none at the first attempt);
- TEST verdict, reason, evidence and revision instruction;
- request state;
- the metadata catalog (`SOURCE_ID + TITLE + HASHTAGS`).

It may return up to 3 `additional_source_ids` from that visible catalog and separately save up to 3 `deferred_source_ids` for the second cycle. Deferred IDs must be copied from the catalog visible in this first REVISION request.

### Second REVISION attempt

The second REVISION receives:
- current montage and its full source texts;
- full text for accepted additional sources from the previous cycle;
- full archive texts resolved locally for only the saved deferred IDs;
- TEST context and previous revision instruction;
- request state.

The deferred IDs are resolved locally through `snapshotIds` and `sourceMap`; the model sees no full catalog and no unrelated source text.

It does not receive the full catalog or full DISCOVER snapshot. It may use the supplied deferred source texts directly in its final montage. It must return empty `additional_source_ids` and `deferred_source_ids` arrays; there is no third revision request. Together, the first-cycle accepted requests (up to 3) and the second-cycle deferred candidates (up to 3) cap the additional source universe at 6.

The model cannot expand the candidate universe in the second cycle by recalling, inventing, or generating arbitrary IDs. A locally existing ID is not eligible merely because it exists: it must also belong to the permitted first-cycle catalog scope or second-cycle deferred queue.

## 5. Source request state

The per-candidate state records:

- `included_source_ids`
- `requested_source_ids`
- `accepted_source_ids`
- `rejected_source_ids`
- `deferred_source_ids`
- `rejection_reasons` (source ID paired with its refusal status)
- `revision_attempt`

The state is included in subsequent REVISION prompts. Repeated requests and already included/rejected sources are not silently accepted.

Refusal statuses:
- `NOT_IN_SNAPSHOT` — ID is absent from the DISCOVER snapshot or is outside the permitted ID scope for this revision.
- `SOURCE_MAP_MISSING` — ID passed snapshot/scope validation but is absent from the local source map; treated as a consistency failure.
- `ALREADY_INCLUDED`
- `ALREADY_REQUESTED`
- `ALREADY_REJECTED`
- `LIMIT_EXCEEDED`
- `DUPLICATE_REQUEST`

A refusal for one ID does not invalidate valid sibling IDs in the same request, except the source-map consistency failure, which aborts the operation.

## 6. REVISION and TEST

REVISION prompts never receive the full DISCOVER snapshot. They receive only current montage texts, accepted additional source texts, applicable catalog metadata/IDs, the previous TEST context and the per-candidate request state.

TEST continues to receive full text for the sources actually used by the current montage. It does not receive the full archive snapshot.

The existing maximum of two REVISION attempts remains unchanged.

## 7. No text fragmentation

The archive audit on `main` at `8f4b49873d403e88a3d8207b8afaddcbb6ffa6ed` measured 3,257 Markdown files:
- BODY mean: 205.44 UTF-16 code units;
- P50: 213;
- P90: 278;
- maximum: 287;
- BODY values over 400: 0.

Therefore no excerpt/truncation strategy is introduced.

## 8. Savings accounting

The measured archive baseline was:
- total BODY: 669,114 characters;
- total TITLE: 281,568 characters;
- BODY/TITLE ratio: approximately 2.376x;
- reduction from BODY to TITLE alone: approximately 57.9%.

This is a TEXT-vs-TITLE comparison, not a claim of 57.9% end-to-end pipeline savings. DISCOVER still receives its full snapshot. The actual metadata catalog also includes SOURCE_ID, HASHTAGS, separators and schema overhead. Exact request size must be measured using prompt/request byte diagnostics.

## 9. Diagnostics

Keep per-stage data separate for SELECT-MONTAGE and REVISION:
- `catalog_chars`
- `full_source_chars`
- `snapshot_chars`
- `requested_source_count`
- `revision_attempt`
- `prompt_bytes`

Provider usage metadata remains separately reported when available. Do not conflate snapshot size, catalog size, full source text, serialized request bytes, and provider token usage.

## 10. Quality validation

Twenty paired historical cases remain a separate quality-validation phase. They evaluate source loss, false semantic links and editorial composition quality; they are not used to calculate token savings.

## 11. Implementation and operational constraints

- Feature branch only; no changes to `main`.
- Draft PR only.
- Do not run the Journal workflow or publish an article as part of this implementation.
- DISCOVER behavior and snapshot generation remain unchanged.
- Review and merge require a separate user decision.
