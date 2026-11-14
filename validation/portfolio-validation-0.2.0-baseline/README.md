# PEKHTOGRAPHY Portfolio Orchestrator v2 — validation package 0.2.0

This is an isolated validation artifact. It is not installed into or committed to the PEKHTOGRAPHY repository.

## Scope
- JSON Schema Draft 2020-12 validation for Candidate and TEST result contracts.
- Ajv 8 plus `ajv-formats` for standards-based format support.
- Runtime validators for graph connectedness, distinct publication-level edges, set equality, exact evidence, observation references, PASS decision invariants, and candidate identity.

## Candidate identity canonicalization
- `snapshot_identity` is the Snapshot top-level `content_sha256` lowercase 64-character SHA-256 digest.
- Exactly six unique `source_ids` are required.
- IDs are sorted using JavaScript default `Array.prototype.sort()` (UTF-16 code-unit order).
- Payload is compact `JSON.stringify({ snapshot_identity, source_ids: sorted })`, with properties in that order.
- Hash the UTF-8 bytes using SHA-256; lowercase hexadecimal; prefix `cand_`.

The full proposed clarification and a test vector are in `CONTRACT-AMENDMENT-CANDIDATE-ID.md`. It is not treated as approved until explicitly accepted.

## Run
```sh
npm install
npm run validate:schema
npm test
```

A successful local run validates only this package. It does not validate the repository branch, the real Snapshot artifact, or a Gemini run.

## Verified in the authoring runtime
- Runtime unit tests: 7/7 passed under Node.js v22.16.0 with built-in experimental TypeScript type stripping.
- Ajv schema compilation/fixture validation: **not run**. Installing pinned Ajv packages timed out in this environment, so no schema validation success is claimed.
