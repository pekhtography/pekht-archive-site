# Contract Amendment — Schema Tooling

**Status:** APPROVED — 2026-11-09  
**Operational tooling update:** 2026-11-12

## 1. Schema ownership

The package validates four Draft 2020-12 schemas: Candidate, TestResult, Snapshot, and DiscoveryRecord. Candidate and TestResult schemas are retained unchanged from 0.2.0. Snapshot and DiscoveryRecord schemas are introduced in 0.2.1.

## 2. Validation layers

Structural parsing and runtime validation are separate. Runtime validators receive typed structures that have already passed schema validation. `parseAndValidateInput` is validator-agnostic; Ajv is integrated through `InputValidator<T>` using `createAjvValidator<T>`.

## 3. Authoritative schema validator

Ajv 8.17.1 is the authoritative and only JSON Schema validation engine in the 0.2.1 package and its required GitHub Actions workflow. It validates the Draft 2020-12 schemas and the explicit fixture matrix.

## 4. Superseded interim Python path

On 2026-11-09, Python `jsonschema==4.26.0` was accepted as an interim independent Draft 2020-12 validator. On 2026-11-12, the project owner chose to remove that supplementary path to simplify local development and CI and avoid a separate Python dependency/runtime.

Accordingly:
- Python validation is not a required gate and is not part of the 0.2.1 package commands.
- `scripts/validate-python.py` and `requirements-validation.txt` are removed.
- GitHub Actions does not install or invoke Python.
- This tooling change does not waive Ajv schema validation, runtime tests, or TypeScript type checking.
- The historical acceptance of Python as an interim independent validator is superseded operationally for this package; it must not be reported as a current PASS or required gate.

## 5. Fixture matrix

The schema script explicitly checks all four schemas and nine fixtures. Missing schemas or fixtures are failures, not silent omissions.

## 6. Test registration

Every new `tests/*.test.mjs` file must be explicitly added to `test:full`. If it does not require Ajv, it must also be added to `test:no-npm`. No test glob is used.
