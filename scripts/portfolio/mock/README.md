# Portfolio Mock Implementation v1

This package is an isolated, deterministic implementation exercise for the
Portfolio Orchestrator. It uses only synthetic in-memory publications and
mock model-call records.

## Explicit boundaries

- No live archive files or repository content are read.
- No Snapshot artifact is downloaded or generated from the site.
- No Gemini endpoint, API key, network request, or external model is used.
- No site runtime, Portfolio production configuration, deployment, or `main`
  branch is changed by this implementation.
- The existing Provider tests remain mock-only; this implementation exercises
  the wider pipeline using synthetic data.

## Executed pipeline

1. Snapshot validation (1,000 synthetic records).
2. Discovery (one record per source; 12 signals and 988 explicit NO_SIGNALs).
3. Global comparison (two deterministic Candidate compositions ranked).
4. Compose (one selected six-source Candidate).
5. Test (the first draft is rejected for a non-verbatim quotation).
6. Revision (one deterministic correction; revision limit remains two).
7. Final validation (structure, exact quotations, Candidate binding and process).
8. Process Audit (complete 1,000-source coverage, candidate shortlist and mock
   model-call records).
9. Result (APPROVED only when all validation layers pass; a separate negative scenario confirms NO_GALLERY when no candidate is selected).

Candidate, Discovery, evidence and TestResult checks reuse the authoritative
runtime validators from Validation 0.2.1. The existing Portfolio Orchestrator
is invoked with injected in-memory Snapshot and mock Provider dependencies.

## Run locally

From the repository root:

```sh
pnpm install --frozen-lockfile
cd validation/portfolio-validation-0.2.1
npm ci
npm run validate:schema
npm run test:full
npm run typecheck
cd ../..
pnpm exec tsx --test scripts/portfolio/mock/implementation.test.ts
```

The GitHub Actions workflow repeats the Validation 0.2.1 gates before running
the mock implementation tests. A successful mock run is not evidence of a
live Gemini run, live Snapshot validity, or production readiness.
