import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  filterEligiblePublications,
  loadLifecycleRegistry,
  type LifecycleRegistry,
} from "./lifecycle-registry.ts";

const NOW = new Date("2026-11-16T00:00:00.000Z");
const pubs = (...ids: string[]) => ids.map((source_id) => ({ source_id, title: source_id }));
const registry = (history: unknown[] = [], active: unknown[] = []): LifecycleRegistry =>
  ({ active_galleries: active, history }) as LifecycleRegistry;
const gallery = (source_ids: string[], removedAt: string, gallery_id = "old") => ({
  gallery_id, source_ids, created_at: "2026-08-01T00:00:00Z",
  removed_photos: source_ids.map((source_id) => ({
    source_id, removedFromExhibitionAt: removedAt,
  })),
});

test("active gallery publications are excluded", () => {
  const r = registry([], [{ gallery_id: "active", source_ids: ["a"], created_at: "2026-11-01T00:00:00Z" }]);
  assert.deepEqual(filterEligiblePublications(pubs("a", "b"), r, NOW).map((p) => p.source_id), ["b"]);
});

test("photo removed 59 days ago remains in cooldown", () => {
  const removedAt = new Date(NOW.getTime() - 59 * 86400000).toISOString();
  assert.deepEqual(filterEligiblePublications(pubs("a"), registry([gallery(["a"], removedAt)]), NOW), []);
});

test("photo removed exactly 60 days ago is eligible", () => {
  const removedAt = new Date(NOW.getTime() - 60 * 86400000).toISOString();
  assert.deepEqual(filterEligiblePublications(pubs("a"), registry([gallery(["a"], removedAt)]), NOW).map(p => p.source_id), ["a"]);
});

test("photo removed 61 days ago is eligible", () => {
  const removedAt = new Date(NOW.getTime() - 61 * 86400000).toISOString();
  assert.deepEqual(filterEligiblePublications(pubs("a"), registry([gallery(["a"], removedAt)]), NOW).map(p => p.source_id), ["a"]);
});

test("partial replacement applies an independent cooldown to each photo", () => {
  const r = registry([{
    gallery_id: "partial", source_ids: ["a", "b"], created_at: "2026-08-01T00:00:00Z",
    removed_photos: [
      { source_id: "a", removedFromExhibitionAt: new Date(NOW.getTime() - 30 * 86400000).toISOString() },
      { source_id: "b", removedFromExhibitionAt: new Date(NOW.getTime() - 90 * 86400000).toISOString() },
    ],
  }]);
  assert.deepEqual(filterEligiblePublications(pubs("a", "b"), r, NOW).map(p => p.source_id), ["b"]);
});

test("publication never present in gallery history remains eligible", () => {
  assert.deepEqual(filterEligiblePublications(pubs("new"), registry(), NOW).map(p => p.source_id), ["new"]);
});

test("empty registry preserves every publication and original order", () => {
  const input = pubs("c", "a", "b");
  assert.deepEqual(filterEligiblePublications(input, registry(), NOW), input);
});

test("duplicate source_id history uses the latest removal timestamp", () => {
  const old = gallery(["a"], "2026-08-01T00:00:00Z", "old-gallery");
  const recent = gallery(["a"], "2026-11-01T00:00:00Z", "new-gallery");
  assert.deepEqual(filterEligiblePublications(pubs("a"), registry([old, recent]), NOW), []);
});

test("missing removedFromExhibitionAt is a validation error", () => {
  const invalid = registry([{
    gallery_id: "broken", source_ids: ["a"], created_at: "2026-08-01T00:00:00Z",
    removed_photos: [{ source_id: "a" }],
  }]);
  assert.throws(() => filterEligiblePublications(pubs("a"), invalid, NOW), /removedFromExhibitionAt.*missing/);
});

test("future removal timestamp is rejected", () => {
  const future = new Date(NOW.getTime() + 1000).toISOString();
  assert.throws(() => filterEligiblePublications(pubs("a"), registry([gallery(["a"], future)]), NOW), /in the future/);
});

test("one second before the exact 60-day boundary remains excluded", () => {
  const removedAt = new Date(NOW.getTime() - 60 * 86400000 + 1000).toISOString();
  assert.deepEqual(filterEligiblePublications(pubs("a"), registry([gallery(["a"], removedAt)]), NOW), []);
});

test("at the exact 60-day boundary the photo becomes eligible", () => {
  const removedAt = new Date(NOW.getTime() - 60 * 86400000).toISOString();
  assert.deepEqual(filterEligiblePublications(pubs("a"), registry([gallery(["a"], removedAt)]), NOW).map(p => p.source_id), ["a"]);
});

test("replaced_at without removed_photos applies to every gallery photo", () => {
  const r = registry([{
    gallery_id: "replaced", source_ids: ["a", "b"], created_at: "2026-08-01T00:00:00Z",
    replaced_at: "2026-11-01T00:00:00Z",
  }]);
  assert.deepEqual(filterEligiblePublications(pubs("a", "b"), r, NOW), []);
});

test("loader reads and validates a JSON registry from disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "portfolio-lifecycle-"));
  const path = join(dir, "registry.json");
  try {
    writeFileSync(path, JSON.stringify({ active_galleries: [], history: [] }), "utf8");
    assert.deepEqual(loadLifecycleRegistry(path), { active_galleries: [], history: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid registry timestamp is rejected", () => {
  const invalid = registry([{
    gallery_id: "bad-date", source_ids: ["a"], created_at: "yesterday",
    replaced_at: "2026-10-01T00:00:00Z",
  }]);
  assert.throws(() => filterEligiblePublications(pubs("a"), invalid, NOW), /created_at.*ISO-8601/);
});
