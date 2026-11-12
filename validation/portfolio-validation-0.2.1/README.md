# PEKHTOGRAPHY Portfolio Orchestrator v2 — Validation 0.2.1

This is an isolated validation package. It is not installed into or committed to the PEKHTOGRAPHY site repository.

## Scope
- Draft 2020-12 schemas for Candidate, TestResult, Snapshot, and DiscoveryRecord.
- Runtime validation for Candidate source coverage, Discovery diagnostics, unambiguous source lookup, observation references, evidence integrity, graph connectedness, distinct publication-level edges, and canonical Candidate identity.
- A schema-independent parse boundary, Ajv adapter, and validated TestResult decision function.
- Independent Python validation using the same schemas and fixtures.

## Candidate identity
Candidate ID canonicalization is **APPROVED 2026-11-09** under Contract Freeze v2, Amendment 1. The algorithm and canonical vector are unchanged from the 0.2.0 source. See `CONTRACT-AMENDMENT-CANDIDATE-ID.md`.

## Run
```sh
npm install
npm run validate:schema
npm run test:no-npm
npm run test:full
npm run typecheck
python -m pip install -r requirements-validation.txt
python scripts/validate-python.py
```

`npm test` is an alias for `npm run test:full`. `test:no-npm` is a limited test tier and does not replace the full suite. `schema-adapter.test.mjs` requires Ajv; when pinned npm dependencies are unavailable, the Ajv-dependent gate is **BLOCKED**, not PASS.

## Test registration rule
Every new `tests/*.test.mjs` file must be explicitly listed in `test:full`. If it does not require Ajv, it must also be listed in `test:no-npm`. Test globs are not used.

## Migration
See `VALIDATION-0.2.1-MIGRATION.md` for unchanged files, additions, modifications, and breaking changes from 0.2.0.

## Eight mandatory gates
1. Candidate schema validation with Ajv — PASS required.
2. TestResult schema validation with Ajv — PASS required.
3. Python validation — PASS required.
4. Ajv validation of all four schemas and nine fixtures — PASS required.
5. Full runtime tests (`npm run test:full`) — PASS required.
6. TypeScript (`tsc --noEmit`) — PASS required.
7. Candidate ID canonical vector rerun in the current environment — PASS required.
8. Contract Amendment 1 approval — APPROVED 2026-11-09.

A `BLOCKED`, `NOT RUN`, or historical result is not a PASS. Passing this package does not validate the live Snapshot, GitHub branch, Preview deployment, or Gemini run. Mock Implementation and Gemini must not run until all eight gates pass.

## GitHub development workflow
The package is reconstructed locally first. A later GitHub stage uses a dedicated branch, small commits, GitHub Actions, Pull Request, and (where relevant) Preview. No changes to the existing site repository, branch, workflow, PR, deployment, or `main` are authorized by this local reconstruction. `main` remains the production source of truth and merge/deploy require separate explicit approval.
