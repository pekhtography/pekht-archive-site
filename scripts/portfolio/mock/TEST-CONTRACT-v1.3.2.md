# Independent TEST Response Contract — Portfolio v1.3.2

**Status:** Response contract and evidence validation implemented in v1.3.2-A. Provider integration and Orchestrator execution are out of scope.

## Versioning

This contract is a versioned extension of v1.3.1. The v1.3.1 schema and validator remain unchanged. The v1.3.2 response schema is `scripts/portfolio/schemas/independent-test-response-v1.3.2.schema.json`.

## Response structure

The response retains:

- `candidate_id`;
- `decision` (`APPROVE` or `REJECT`);
- five integer scores from 1 to 5;
- structured `findings`;
- `blocking_issues`.

Each finding contains:

- `criterion`: one of the five approved evaluation criteria;
- `issue`: a non-empty explanation;
- `blocking`: boolean;
- `evidence`: exactly one typed evidence reference.

## Evidence references

### SOURCE

`{ "kind": "SOURCE", "source_id": "...", "quote": "..." }`

The source ID must belong to the six supplied source publications. The quote must occur exactly as a substring in that source's canonical Snapshot `body`. The validator receives the six complete body values as validation context; it does not normalize or rewrite them.

### COMPOSITION

`{ "kind": "COMPOSITION", "path": "/...", "quote": "..." }`

The path is a non-root RFC 6901 JSON Pointer into the actual composition object. It must resolve to a string value, and the quote must occur exactly as a substring at that location. JSON Pointer escapes `~0` and `~1` are supported; malformed escapes, missing paths, non-string targets, and inexact quotes fail validation.

## Decision semantics

- All five scores are integers from 1 through 5.
- APPROVE requires scores of at least 4 for semantic coherence, curatorial originality, narrative integrity, and visual composition; evidence integrity must equal 5.
- APPROVE requires an empty `blocking_issues` array and no finding with `blocking: true`.
- REJECT requires at least one non-empty `blocking_issue` and at least one finding with `blocking: true`.
- REJECT may report evidence integrity below 5.
- A structurally valid response with an unsupported or inexact evidence reference is invalid and cannot be accepted as APPROVE or REJECT.

## Validation boundary

Ajv validates the versioned response structure and decision-dependent constraints. The TypeScript runtime validator additionally receives the six source texts and composition object, verifies the context has exactly six complete source texts, resolves evidence references, and checks exact quote occurrence.

The validator does not perform provider invocation, model selection, Revision, Orchestrator status transitions, or Process Audit integration. Those belong to later v1.3.2 stages.

## Scope

This stage changes only response types, the new versioned schema, runtime evidence validation, fixtures, tests, and CI wiring. It does not modify the v1.3.1 schema, integrate a live provider, change Orchestrator execution, run Gemini, read live archive data, create a PR, merge, or deploy.
