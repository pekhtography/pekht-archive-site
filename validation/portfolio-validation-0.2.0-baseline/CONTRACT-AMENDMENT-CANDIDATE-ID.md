# Contract Freeze v2 — proposed clarification

## Candidate identity canonicalization

This text is proposed as an amendment/clarification. It is not considered approved until explicitly accepted.

Given Snapshot top-level `content_sha256` and exactly six unique `source_ids`:

1. `snapshot_identity` is the exact lowercase 64-character hexadecimal value of `content_sha256`.
2. Sort `source_ids` using JavaScript `Array.prototype.sort()` default ordering (UTF-16 code units).
3. Construct the object with properties in this exact order:
   - `snapshot_identity`
   - `source_ids`
4. Serialize using compact JSON equivalent to `JSON.stringify({ snapshot_identity, source_ids: sorted })`, with no insignificant whitespace.
5. Encode the serialized string as UTF-8.
6. Compute SHA-256 over those bytes, render lowercase hexadecimal, and prefix `cand_`.

Canonical test vector:
- `snapshot_identity`: 64 lowercase `a` characters
- input IDs: `305,355,655,805,749,524`
- sorted IDs: `305,355,524,655,749,805`
- result: `cand_4842d793284c56fc53a1e8453133677bc9c85c7e351732a8f13ff9cba87edea1`

The six-ID cardinality and uniqueness checks occur before serialization and hashing.
