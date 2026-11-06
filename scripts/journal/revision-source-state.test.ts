import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSourceCatalog,
  createRevisionSourceState,
  initializeDeferredSourceIds,
  resolveAdditionalSourceRequests,
  serializeRevisionSourceState,
  validateSourceRequestContract,
} from "./revision-source-state.ts";

const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
const snapshot = new Set(ids);
const sourceMap = new Map(ids.map((id) => [id, { source_id: id }]));

test("catalog contains SOURCE_ID, TITLE and HASHTAGS only", () => {
  const catalog = buildSourceCatalog([{ source_id: "a", title: "Title A", hashtags: ["#light"] }]);
  assert.match(catalog, /SOURCE_ID: a/);
  assert.match(catalog, /TITLE: Title A/);
  assert.match(catalog, /HASHTAGS: #light/);
  assert.doesNotMatch(catalog, /TEXT:|DATE:/);
});

test("deferred IDs come only from the first visible catalog, are unique and capped at three", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  const catalogIds = new Set(["a", "b", "c", "d", "e", "f", "g"]);
  const deferred = initializeDeferredSourceIds(
    ["e", "f", "g", "h", "e"], catalogIds, snapshot, sourceMap, state,
  );
  assert.deepEqual(deferred, ["e", "f", "g"]);
  assert.deepEqual(initializeDeferredSourceIds(["h"], catalogIds, snapshot, sourceMap, state), ["e", "f", "g"]);
});

test("arbitrary IDs not in the visible catalog cannot enter the deferred queue", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  assert.deepEqual(
    initializeDeferredSourceIds(["h", "not-real"], new Set(["a", "b", "c", "d", "e"]), snapshot, sourceMap, state),
    [],
  );
});

test("request resolver accepts at most three allowed snapshot IDs", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  const result = resolveAdditionalSourceRequests({
    requestedIds: ["e", "f", "g", "h"],
    allowedIds: new Set(ids),
    snapshotIds: snapshot,
    sourceMap,
    state,
  });
  assert.deepEqual(result.accepted_source_ids, ["e", "f", "g"]);
  assert.deepEqual(result.rejected, [{ source_id: "h", status: "LIMIT_EXCEEDED" }]);
});

test("all refusal statuses are enforced", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  state.requested_source_ids.add("e");
  state.accepted_source_ids.add("e");
  state.rejected_source_ids.add("f");
  const result = resolveAdditionalSourceRequests({
    requestedIds: ["outside", "a", "e", "f", "g", "g"],
    allowedIds: new Set(["a", "b", "c", "d", "e", "f", "g"]),
    snapshotIds: snapshot,
    sourceMap,
    state,
  });
  assert.deepEqual(result.rejected, [
    { source_id: "outside", status: "NOT_IN_SNAPSHOT" },
    { source_id: "a", status: "ALREADY_INCLUDED" },
    { source_id: "e", status: "ALREADY_REQUESTED" },
    { source_id: "f", status: "ALREADY_REJECTED" },
    { source_id: "g", status: "DUPLICATE_REQUEST" },
  ]);
  assert.deepEqual(state.rejection_reasons, result.rejected);
});

test("a missing sourceMap entry is a consistency error, not a silent partial acceptance", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  assert.throws(() => resolveAdditionalSourceRequests({
    requestedIds: ["h"],
    allowedIds: new Set(["h"]),
    snapshotIds: snapshot,
    sourceMap: new Map(),
    state,
  }), /SOURCE_MAP_MISSING/);
});

test("second revision receives only deferred IDs, while state remains serializable", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  initializeDeferredSourceIds(["e", "f"], new Set(ids), snapshot, sourceMap, state);
  resolveAdditionalSourceRequests({
    requestedIds: ["g"],
    allowedIds: new Set(ids),
    snapshotIds: snapshot,
    sourceMap,
    state,
  });
  assert.deepEqual(state.deferred_source_ids, ["e", "f"]);
  assert.deepEqual(serializeRevisionSourceState(state, 2), {
    included_source_ids: ["a", "b", "c", "d"],
    requested_source_ids: ["g"],
    accepted_source_ids: ["g"],
    rejected_source_ids: [],
    deferred_source_ids: ["e", "f"],
    deferred_rejections: [],
    rejection_reasons: [],
    revision_attempt: 2,
  });
});

test("the deferred queue is an explicit whitelist for second-cycle source candidates", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  initializeDeferredSourceIds(["e", "f"], new Set(ids), snapshot, sourceMap, state);
  const result = resolveAdditionalSourceRequests({
    requestedIds: ["g", "e"],
    allowedIds: new Set(state.deferred_source_ids),
    snapshotIds: snapshot,
    sourceMap,
    state,
  });
  assert.deepEqual(result.accepted_source_ids, ["e"]);
  assert.deepEqual(result.rejected, [{ source_id: "g", status: "NOT_IN_SNAPSHOT" }]);
});

test("deferred candidates enforce the three-ID cap and record over-limit IDs", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  const accepted = initializeDeferredSourceIds(["e", "f", "g", "h"], new Set(ids), snapshot, sourceMap, state);
  assert.deepEqual(accepted, ["e", "f", "g"]);
  assert.deepEqual(state.deferred_rejections, [{ source_id: "h", status: "LIMIT_EXCEEDED" }]);
  assert.deepEqual(state.rejection_reasons, [{ source_id: "h", status: "LIMIT_EXCEEDED" }]);
});


test("SOURCE_MAP_MISSING is recorded and diagnosed before the consistency error aborts", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  const diagnostics: Array<{ source_id: string; status: string }> = [];
  assert.throws(() => resolveAdditionalSourceRequests({
    requestedIds: ["h"], allowedIds: new Set(["h"]), snapshotIds: snapshot,
    sourceMap: new Map(), state,
    onSourceMapMissing: (rejection) => {
      diagnostics.push(rejection);
      assert.equal(state.rejected_source_ids.has("h"), true);
      assert.deepEqual(state.rejection_reasons.at(-1), rejection);
    },
  }), /SOURCE_MAP_MISSING/);
  assert.equal(state.rejected_source_ids.has("h"), true);
  assert.deepEqual(state.rejection_reasons, [{ source_id: "h", status: "SOURCE_MAP_MISSING" }]);
  assert.deepEqual(diagnostics, [{ source_id: "h", status: "SOURCE_MAP_MISSING" }]);
});

test("ordinary refusal does not prevent valid sibling IDs from being accepted", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  const result = resolveAdditionalSourceRequests({
    requestedIds: ["outside", "e", "f"], allowedIds: new Set(["e", "f"]),
    snapshotIds: snapshot, sourceMap, state,
  });
  assert.deepEqual(result.rejected, [{ source_id: "outside", status: "NOT_IN_SNAPSHOT" }]);
  assert.deepEqual(result.accepted_source_ids, ["e", "f"]);
  assert.deepEqual([...state.requested_source_ids], ["e", "f"]);
});

test("deferred SOURCE_MAP_MISSING is recorded and diagnosed before aborting", () => {
  const state = createRevisionSourceState(["a", "b", "c", "d"]);
  const diagnostics: Array<{ source_id: string; status: string }> = [];
  assert.throws(() => initializeDeferredSourceIds(
    ["e"], new Set(["a", "b", "c", "d", "e"]), snapshot, new Map(), state,
    (rejection) => {
      diagnostics.push(rejection);
      assert.equal(state.rejected_source_ids.has("e"), true);
      assert.deepEqual(state.rejection_reasons.at(-1), rejection);
    },
  ), /SOURCE_MAP_MISSING/);
  assert.deepEqual(diagnostics, [{ source_id: "e", status: "SOURCE_MAP_MISSING" }]);
});


test("initial SELECT-MONTAGE rejects non-empty additional and deferred source arrays", () => {
  const violations = validateSourceRequestContract({
    stage: "INITIAL_SELECT_MONTAGE",
    additionalSourceIds: ["e"],
    deferredSourceIds: ["f", "g"],
  });
  assert.deepEqual(violations, [
    { field: "additional_source_ids", status: "UNEXPECTED_ADDITIONAL_IDS", source_ids: ["e"] },
    { field: "deferred_source_ids", status: "UNEXPECTED_DEFERRED_IDS", source_ids: ["f", "g"] },
  ]);
});

test("second REVISION rejects non-empty additional and deferred source arrays", () => {
  const violations = validateSourceRequestContract({
    stage: "SECOND_REVISION",
    additionalSourceIds: ["outside"],
    deferredSourceIds: ["unapproved"],
  });
  assert.deepEqual(violations, [
    { field: "additional_source_ids", status: "UNEXPECTED_ADDITIONAL_IDS", source_ids: ["outside"] },
    { field: "deferred_source_ids", status: "UNEXPECTED_DEFERRED_IDS", source_ids: ["unapproved"] },
  ]);
});
