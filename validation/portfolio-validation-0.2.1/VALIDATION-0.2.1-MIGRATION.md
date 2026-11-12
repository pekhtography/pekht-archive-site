# Validation 0.2.0 → 0.2.1 Migration

## Preservation

The 0.2.0 source package is retained separately as an immutable baseline. No original file is silently overwritten. `candidate.schema.json`, `test-result.schema.json`, the three TestResult fixtures, and `tsconfig.json` are unchanged in 0.2.1.

## File migration matrix

| File | 0.2.1 disposition | Change |
|---|---|---|
| `schemas/candidate.schema.json` | UNCHANGED | Original Candidate schema retained |
| `schemas/test-result.schema.json` | UNCHANGED | Original TestResult schema retained |
| `schemas/snapshot.schema.json` | NEW | Snapshot structural schema |
| `schemas/discovery-record.schema.json` | NEW | DiscoveryRecord structural schema |
| `src/types.ts` | CHANGED | Adds DiscoveryResult and TestDecision types; existing data contracts retained |
| `src/validators.ts` | CHANGED | Adds D-01/D-03 validators and safe lookup; integrates T-08 sequence; narrows evidence scope |
| `src/parse.ts` | NEW | Generic parser/validator boundary |
| `src/ajv-adapter.ts` | NEW | Ajv adapter implementing InputValidator |
| `src/decide.ts` | NEW | `decideTestResult` after successful validation |
| `tests/validators.test.mjs` | CHANGED | T-01–T-10 runtime coverage and new evidence signature |
| `tests/parse.test.mjs` | NEW | Parser boundary tests |
| `tests/decide.test.mjs` | NEW | Decision tests |
| `tests/schema-adapter.test.mjs` | NEW | Ajv adapter tests |
| `scripts/validate-schema.mjs` | CHANGED | Explicit four-schema/nine-fixture matrix |
| `scripts/validate-python.py` | REMOVED 2026-11-12 | Temporary independent Python validator retired; Ajv remains the authoritative schema validator |
| `fixtures/test-result.pass.*.json` | UNCHANGED | Original three TestResult fixtures |
| `fixtures/candidate.pass.valid.json` | NEW | Valid Candidate fixture |
| `fixtures/candidate.fail.source-count.json` | NEW | Candidate cardinality failure |
| `fixtures/candidate.fail.duplicate-source.json` | NEW | Candidate uniqueness failure |
| `fixtures/candidate.fail.candidate-id.json` | NEW | Structurally valid but runtime ID mismatch fixture; schema-valid by design |
| `fixtures/snapshot.valid.json` | NEW | Snapshot fixture |
| `fixtures/discovery.valid.json` | NEW | Discovery fixture |
| `package.json` | CHANGED | Version 0.2.1 and explicit test tiers; direct dependency versions pinned |
| `package-lock.json` | NEW | npm lockfile v3; pins the complete resolved dependency tree for `npm ci` |
| `tsconfig.json` | UNCHANGED | Original compiler configuration retained |
| `requirements-validation.txt` | REMOVED 2026-11-12 | No Python dependency in the package or CI |
| `README.md` | CHANGED | 0.2.1 scope, gates, commands and migration guidance; documents `npm ci` |
| `CONTRACT-AMENDMENT-CANDIDATE-ID.md` | CHANGED | Approval status added; canonical algorithm/vector unchanged |
| `CONTRACT-AMENDMENT-SCHEMA-TOOLING.md` | NEW | Approved tooling policy |
| `VALIDATION-0.2.1-MIGRATION.md` | NEW | This migration record |

## Breaking changes

1. `validateEvidenceAgainstSnapshot` changes from `(records, snapshot)` to `(candidate, snapshot, records)`.
2. Evidence validation is restricted to observations declared by the Candidate. Evidence in unrelated Discovery records is not evaluated for this Candidate.
3. `validateCandidate` now runs Discovery diagnostics, creates an unambiguous source lookup, checks Candidate source coverage, observation references, distinct edges, graph connectivity, Candidate-scoped evidence, and Candidate ID in the agreed T-08 order.
4. All records sharing a duplicate `source_id` are excluded from the safe lookup. The implementation never chooses first or last.
5. Discovery `result`/`observations` consistency remains an output-contract responsibility and is not duplicated by runtime validators.

## Gate interpretation

`BLOCKED` and `NOT RUN` are not `PASS`. `test:no-npm` is partial coverage only. Ajv is the authoritative JSON Schema validator; Python validation was a temporary supplementary path and was retired by the 2026-11-12 tooling decision. The package lockfile records the complete npm dependency tree, and the required workflow uses `npm ci` for deterministic installation. Mock Implementation and Gemini remain prohibited until all seven mandatory gates pass.
