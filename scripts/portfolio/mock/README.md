# Portfolio Mock Implementation v1.2

A deterministic, synthetic-only execution harness for the Portfolio Orchestrator. The harness executes its stages in dependency order; it does not prepare downstream results in a fixture and then write a retrospective stage log.

## Safety boundary

- Uses 1,000 synthetic in-memory publications only.
- Does not read the live archive or a generated Snapshot artifact.
- Does not call Gemini, use an API key, or make network requests.
- Provider calls are injected deterministic `mock://` responses only.
- Does not change production configuration, the site runtime, `main`, or deployment.
- A successful mock run is not evidence of live-model or production readiness.

## Executed stages

The approved scenario executes and records:

1. Snapshot Validation.
2. Discovery: exactly one valid `SIGNALS_FOUND` or `NO_SIGNAL` record for each of the 1,000 sources.
3. Candidate Generation: builds and validates Candidates from the actual Discovery records.
4. Global Comparison: computes Candidate scores from observation count, signal diversity, lexical diversity and graph connectivity, then applies a configurable threshold in the inclusive range 0–1.
5. Compose: builds a six-source draft from the selected Candidate and exact source text.
6. TEST: creates and validates a `TestResult` only after composition; the synthetic first attempt deliberately contains a non-verbatim quotation and is rejected.
7. REVISION: runs only after a TEST rejection, with a maximum of two cycles, then TEST runs again on the revised draft.
8. Final Validation: invokes the existing Portfolio Orchestrator for independent structural, semantic and process validation.
9. Process Audit: compares the completed stage log against a separate start/complete event trace and revalidates actual model-call records.
10. Result.

The separate NO_GALLERY scenario uses a strict but reachable score threshold of 0.99. It completes Snapshot Validation, Discovery, Candidate Generation and Global Comparison, then returns NO_GALLERY without Compose, TEST or Revision.

## Execution integrity

- `createMockPortfolioFixture()` creates only the synthetic Snapshot and its validation projection. It does not validate the Snapshot, run Discovery, build Candidates or create TestResults.
- Each stage function is invoked only after its predecessor completes successfully.
- Candidate Generation receives the actual validated Discovery records; Global Comparison receives the Candidates it just generated.
- TestResults are local to TEST execution and are exposed in the report only after TEST has run.
- `event_trace` records actual stage START and COMPLETE events independently of `execution_log`.
- Process Audit rejects missing, duplicated, reordered or mismatched stage events.
- Failure-injection tests verify that upstream failures block downstream work.

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
