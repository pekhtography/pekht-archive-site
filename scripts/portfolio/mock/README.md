# Portfolio Mock Implementation v1.1

A deterministic, synthetic-only execution harness for the Portfolio Orchestrator.

## Safety boundary

- Uses 1,000 synthetic in-memory publications only.
- Does not read the live archive or a generated Snapshot artifact.
- Does not call Gemini, use an API key, or make network requests.
- Does not change production configuration, the site runtime, `main`, or deployment.
- A successful mock run is not evidence of live-model or production readiness.

## Executed stages

The approved scenario executes and records, in order:

1. Snapshot validation.
2. Discovery: exactly one result for each of the 1,000 sources.
3. Global Comparison: computes Candidate scores from observation count, signal diversity, lexical diversity and graph connectivity, then ranks the shortlist.
4. Compose: builds a six-source draft from the selected Candidate and exact source text.
5. Test: rejects an intentionally altered quotation.
6. Revision: repairs the quotation through a bounded revision loop (maximum two attempts).
7. Final Validation: independently checks structure and semantic evidence.
8. Process Audit: validates the actual stage log, coverage, shortlist, model-call records and revision count.
9. Result: returns APPROVED only after the existing Orchestrator's final validation passes.

The separate NO_GALLERY scenario executes Snapshot Validation, Discovery and Global Comparison, records an empty selected shortlist, and returns NO_GALLERY without composing a gallery.

The stage log is created as each stage completes and then checked for order and contiguous sequence numbers. It is not pre-populated as a claimed result.

## Validation and local execution

Candidate identity, Discovery coverage, Candidate graph/evidence and TestResult thresholds reuse Validation 0.2.1 validators. The existing Portfolio Orchestrator remains the final structural, semantic and process-validation boundary.

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

The Validation 0.2.1 TypeScript project includes the mock implementation and tests so the separate typecheck covers them. The GitHub Actions workflow reruns all validation gates before mock tests.
