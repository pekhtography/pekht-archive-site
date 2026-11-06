import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

test("DISCOVER still receives the full snapshot while SELECT-MONTAGE uses metadata plus selected full texts", async () => {
  const source = await readFile(new URL("../journal-orchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /ARCHIVE SNAPSHOT \(EXPLORE-ORDERED STRATIFIED SAMPLE OF CURRENT ARCHIVE\):\\n\$\{snapshot\}/);
  assert.match(source, /AVAILABLE SOURCE CATALOG \(SOURCE_ID \+ TITLE \+ HASHTAGS; no TEXT or DATE\)/);
  assert.match(source, /FULL TEXTS OF SELECTED DISCOVER SOURCES:[\\n\$]*\$\{currentSourceTexts\}/);
  assert.doesNotMatch(source.slice(source.indexOf("const task2Prompt"), source.indexOf('ensureBudget("SELECT-MONTAGE response")')), /\$\{snapshot\}/);
});

test("REVISION attempt 1 gets the catalog; attempt 2 gets only deferred full texts", async () => {
  const source = await readFile(new URL("../journal-orchestrator.ts", import.meta.url), "utf8");
  const revisionPrompt = source.slice(source.indexOf("const task2Prompt"), source.indexOf('ensureBudget("SELECT-MONTAGE response")'));
  assert.match(revisionPrompt, /revisionAttempt === 1 \? `AVAILABLE SOURCE CATALOG/);
  assert.match(revisionPrompt, /revisionAttempt === 2 \? `FULL TEXTS OF DEFERRED SOURCES/);
  assert.match(revisionPrompt, /sourcesFor\(revisionSourceState\.deferred_source_ids\)/);
  assert.match(revisionPrompt, /FULL TEXTS OF ACCEPTED ADDITIONAL SOURCES/);
  assert.match(revisionPrompt, /PREVIOUS TEST CONTEXT/);
  assert.match(revisionPrompt, /SOURCE REQUEST STATE/);
  assert.doesNotMatch(revisionPrompt, /AVAILABLE SOURCE CATALOG[\s\S]*revisionAttempt === 2/);
});

test("every montage source must have a locally supplied full text", async () => {
  const source = await readFile(new URL("../journal-orchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /availableFullTextIds = new Set\(\[\.\.\.candidateSourceIds, \.\.\.revisionSourceState\.accepted_source_ids, \.\.\.revisionSourceState\.deferred_source_ids\]\)/);
  assert.match(source, /SOURCE_TEXT_NOT_SUPPLIED/);
  assert.match(source, /snapshotIds,\s*sourceMap,\s*state: revisionSourceState/);
});

test("prompt diagnostics separate snapshot, catalog, full source and serialized prompt bytes", async () => {
  const source = await readFile(new URL("../journal-orchestrator.ts", import.meta.url), "utf8");
  for (const field of ["catalog_chars", "full_source_chars", "snapshot_chars", "requested_source_count", "revision_attempt", "prompt_bytes"]) {
    assert.ok(source.includes(field), `missing diagnostic field ${field}`);
  }
  assert.match(source, /stage: "DISCOVER"[\s\S]*snapshot_chars: snapshot\.length/);
  assert.match(source, /stage: currentMontage \? "REVISION" : "SELECT-MONTAGE"/);
});

test("REVISION is represented as its own provider diagnostic stage", async () => {
  const provider = await readFile(new URL("./provider.ts", import.meta.url), "utf8");
  const orchestrator = await readFile(new URL("../journal-orchestrator.ts", import.meta.url), "utf8");
  assert.match(provider, /"SELECT-MONTAGE" \| "REVISION" \| "TEST"/);
  assert.match(orchestrator, /"SELECT-MONTAGE", "REVISION", "TEST"/);
});
