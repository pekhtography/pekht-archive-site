# Contract Amendment — Schema Tooling

**Status:** APPROVED — 2026-11-09

## 1. Schema ownership

The package validates four Draft 2020-12 schemas: Candidate, TestResult, Snapshot, and DiscoveryRecord. Candidate and TestResult schemas are retained unchanged from 0.2.0. Snapshot and DiscoveryRecord schemas are introduced in 0.2.1.

## 2. Validation layers

Structural parsing and runtime validation are separate. Runtime validators receive typed structures that have already passed schema validation. `parseAndValidateInput` is validator-agnostic; Ajv is integrated through `InputValidator<T>` using `createAjvValidator<T>`.

## 3. Dependency boundaries

`test:no-npm` runs tests that do not import Ajv. `test:full` and `npm test` include the Ajv adapter tests and require installed pinned npm dependencies. Python validation is a separate gate and does not replace Ajv validation.

## 4. Fixture matrix

The schema script explicitly checks all four schemas and nine fixtures. Missing schemas or fixtures are failures, not silent omissions.

## 5. Test registration

Every new `tests/*.test.mjs` file must be explicitly added to `test:full`. If it does not require Ajv, it must also be added to `test:no-npm`. No test glob is used.
