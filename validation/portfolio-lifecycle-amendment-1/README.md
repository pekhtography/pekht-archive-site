# Portfolio Lifecycle Amendment 1 — Contracts

Status: additive contract draft prepared from the approved Amendment 1 decisions. This directory is deliberately isolated from the existing Validation 0.2.1 package and production Orchestrator.

## Approved parameters

- Candidate pool: maximum 100 generated, deduplicated, structurally validated Candidate records.
- Global Comparison: two stages.
- Stage 2: all unordered pairs among at most 10 Stage 1 finalists (maximum 45 comparisons).
- Shortlist: maximum 10 Candidate; greedy scan of final ranking; no more than 3 shared source IDs between any two selected Candidate.
- Tie-break: lexicographic criterion tuple; Candidate ID ascending as final deterministic fallback.

## Files

- `schemas/candidate-pool.schema.json`: validated Candidate pool and immutable Candidate artifact references.
- `schemas/candidate-validation-report.schema.json`: validation result for every generated proposal, including rejected proposals.
- `schemas/global-comparison-stage1.schema.json`: individual five-criterion evaluation, eligible ranking, and top-10 finalists.
- `schemas/global-comparison-stage2.schema.json`: complete pairwise results, Copeland standings, final ranking, and overlap-constrained shortlist.
- `schemas/process-audit-v2.schema.json`: additive process audit that distinguishes the 100-Candidate pool from the 10-Candidate shortlist.
- `scripts/portfolio/validation/lifecycle-amendment-1-contracts.ts`: TypeScript types corresponding to the new artifact contracts.
- `package.json` / `package-lock.json`: isolated, locked Ajv 8.17.1 and TypeScript 5.8.3 validation toolchain.
- `fixtures/valid/` and `fixtures/invalid/`: positive and negative fixture matrix.
- `tests/contracts.test.mjs`: Ajv fixture tests.\n- `runtime/validate-amendment-1.mjs`: independent cross-artifact and algorithmic invariant validator.\n- `tests/runtime.test.mjs`: runtime invariant tests covering valid lifecycle reconciliation, pair completeness, deterministic ranking, Candidate hashes, and shortlist overlap.
- `.github/workflows/portfolio-lifecycle-amendment-1.yml`: branch-scoped CI for schema compilation, fixtures, and typecheck.

## Stage definitions

### Candidate Generation and validation

The generation stage may emit no more than 100 proposals. The validation report records every proposal and its PASS/REJECTED result. The Candidate Pool contains only PASS proposals, deduplicated by canonical Candidate ID. A duplicate ID with byte-identical canonical content is deduplicated; the same ID with different content is an identity conflict and makes the run INCOMPLETE. A response exceeding 100 proposals is not truncated: the run is INCOMPLETE.

A completed Candidate Generation stage emits at most 100 proposals; a response exceeding 100 is not truncated and yields INCOMPLETE. The Candidate Pool artifact always has generation_status=COMPLETE and contains only PASS proposals. Its candidates array may be empty: this covers both no proposals and the case where every proposal was rejected, which are distinguished by the validation report. A valid empty pool is a content outcome and yields NO_GALLERY. A provider, quota, timeout, parse, or schema failure is technical and yields INCOMPLETE.

Each Candidate remains subject to the existing Candidate schema, canonical Candidate ID function, and Validation 0.2.1 runtime validators. Those contracts are reused, not copied or redefined here.

### Global Comparison Stage 1

Every Candidate in the validated pool receives exactly one evaluation containing exactly one score (integer 1–5), rationale, and evidence set for each criterion:

1. `semantic_coherence`
2. `curatorial_originality`
3. `narrative_integrity`
4. `evidence_integrity`
5. `visual_composition_potential`

The first four criteria must cite Discovery observation IDs. Visual composition potential must cite source-image references and is limited to visual sequence/composition; it must not be used as evidence of semantic meaning.

Any Candidate with a blocking issue is ineligible. Eligible Candidate are ranked by the five scores in the listed order, descending, then by `candidate_id` ascending. Stage 1 finalists are the first ten IDs in that ranking. If no Candidate is eligible, Stage 1 has an empty ranking and no finalists.

### Global Comparison Stage 2

Every unordered pair among the Stage 1 finalists is compared exactly once. Pair IDs are stored in canonical lexical order. The outcome is `A_WINS`, `B_WINS`, or `DRAW`.

Copeland score is wins minus losses; draws contribute zero. Final ranking is Copeland score descending, then the Stage 1 five-score tuple descending, then `candidate_id` ascending. This produces a deterministic ranking even if pairwise preferences contain cycles.

For a non-empty Candidate pool but zero eligible finalists, Stage 2 contains empty comparisons, standings, ranking, and shortlist. For one finalist, it contains one standing and no pairwise comparisons. If the Candidate pool itself is empty, Global Comparison is NOT_APPLICABLE_EMPTY_POOL: no Stage 1 or Stage 2 artifacts are fabricated, and the completed upstream pipeline yields NO_GALLERY.

### Shortlist

Scan the final ranking from top to bottom. Add a Candidate only if its source-ID intersection with every already selected Candidate is at most three. Stop at ten selected Candidate or when the ranking is exhausted. A shortlist may contain fewer than ten Candidate. Do not backfill with candidates that violate the overlap rule.

## Runtime invariants

JSON Schema checks individual artifact structure. Independent runtime validation must additionally reconcile artifact contents and hashes, enforce set equality and ordering, verify all pair combinations, recompute Copeland scores, recompute both rankings, and verify the greedy overlap-constrained shortlist. A schema PASS alone is not a Global Comparison PASS.

The executable runtime gate is exposed as `validateLifecycleAmendment1(input)` from `runtime/validate-amendment-1.mjs`. It accepts parsed Snapshot/Discovery/Candidate/Comparison artifacts, the Process Audit, and the exact UTF-8 artifact contents keyed by `discovery`, `candidate_pool`, `candidate_validation`, `stage1`, and `stage2`. Candidate artifact contents are supplied by Candidate ID. The validator recomputes SHA-256 from those exact strings; it does not trust hashes copied into metadata. It also parses each artifact and deep-compares it with the corresponding supplied object, preventing a caller from validating one in-memory object while persisting different artifact bytes. It verifies 1000-source Discovery coverage, Candidate Pool/report reconciliation, source ownership, Stage 1 evidence and ranking, Stage 2 pair completeness and outcomes, Copeland standings, final ranking, greedy overlap shortlist, audit mappings, and model-call stage/candidate rules.\n\nThe validator returns `{ valid, errors }`; callers must treat any non-empty error list as a hard validation failure. It validates model-call stage/Candidate association, but does not implement Provider fallback-chain policy or full COMPOSE/TEST/REVISION call ordering. Those remain separate Provider/Orchestrator gates. It is deliberately not wired into the production Orchestrator in this stage.\n\nThe process audit uses `global_comparison.status`. `COMPLETED` is allowed only after both stages, all comparisons, ranking, shortlist, artifact persistence, and cross-artifact validation have completed. `NOT_APPLICABLE_EMPTY_POOL` is allowed only when the validated Candidate pool is empty; it has no Stage 1 or Stage 2 artifact references.

## Compatibility and migration boundary

These files are additive. They do not modify:

- `scripts/portfolio/validation/types.ts`;
- `scripts/portfolio/validation/process-validator.ts`;
- `scripts/portfolio/orchestrator.ts`;
- the existing Validation 0.2.1 schemas or validators;
- the provider, Gemini model chain, workflows, deployment, or `main`.

The existing `ProcessAudit.candidateIds` remains the maximum-10 shortlist in the current contract. The new `PortfolioProcessAuditV2.candidate_pool_ids` separately represents the maximum-100 pool. No implicit field reinterpretation is allowed.

The existing Discovery Record and Candidate schemas are reused by reference at the validation boundary. Ajv integration must register the existing Discovery Record and Candidate schemas before validating dependent artifacts.

## Validation commands

Run from this directory:

- `npm ci --no-audit --no-fund`
- `npm run validate:schema` — compile all five Draft 2020-12 schemas with Ajv 8.17.1.
- `npm run test:full` — run positive and negative schema fixtures plus runtime invariant tests.
- `npm run typecheck` — typecheck the additive TypeScript contracts.

The branch-scoped workflow runs these three gates on pushes to `portfolio/lifecycle-amendment-1-contracts` and can also be started manually. Fixture tests prove structural schema acceptance/rejection only. Cross-artifact ordering, ranking, Copeland calculations, pair completeness, hash verification, and overlap rules remain runtime invariants and are not claimed as Ajv guarantees.
