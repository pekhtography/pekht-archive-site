import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PORTFOLIO_SNAPSHOT_POST_COUNT,
  PORTFOLIO_SNAPSHOT_PURPOSE,
  readPortfolioSnapshot,
  validatePortfolioSnapshot,
} from "./snapshot.ts";

function fixture() {
  const posts = Array.from({ length: PORTFOLIO_SNAPSHOT_POST_COUNT }, (_, index) => ({
    source_id: `source-${index}`,
    x_id: String(1000 + index),
    title: `Title ${index}`,
    body: `Full text ${index} #meaning`,
    hashtags: [],
    image: `/images/${index}.jpg`,
    created_at: "2025-01-01T00:00:00Z",
    original_markdown: `---\ntitle: Title ${index}\n---\nFull text ${index} #meaning`,
  }));
  return {
    schema_version: 1,
    purpose: PORTFOLIO_SNAPSHOT_PURPOSE,
    generated_at: "2026-11-01T17:22:19.232Z",
    repository_commit: "a".repeat(40),
    sampler: {
      function: "stratifiedSample",
      source_file: "src/lib/stratified-sample.ts",
      sort_function: "sortExploreItems",
      sort_source_file: "src/lib/explore-sort.ts",
      requested_count: 1000,
      random_seed: null,
      reproducibility: "Source records are preserved.",
    },
    archive_markdown_count: 3246,
    active_gallery_exclusions: [{ gallery_id: "305", source_id: "active-source" }],
    cooldown_exclusions: [],
    eligible_archive_count: 3240,
    sampled_count: 1000,
    sampled_source_ids: posts.map((post) => post.source_id),
    content_sha256: "b".repeat(64),
    posts,
  };
}

test("accepts a complete 1000-post snapshot and maps run metadata", async () => {
  const snapshot = fixture();
  assert.equal(validatePortfolioSnapshot(snapshot), true);

  const dir = await mkdtemp(join(tmpdir(), "portfolio-snapshot-"));
  try {
    const file = join(dir, "snapshot.json");
    await writeFile(file, JSON.stringify(snapshot), "utf8");
    const loaded = await readPortfolioSnapshot(file);

    assert.equal(loaded.snapshot.posts.length, 1000);
    assert.equal(loaded.snapshot.posts[0].body, "Full text 0 #meaning");
    assert.equal(loaded.input_snapshot.schema_version, "1");
    assert.equal(loaded.input_snapshot.repository_commit, "a".repeat(40));
    assert.equal(loaded.input_snapshot.sampled_count, 1000);
    assert.equal(loaded.input_snapshot.content_sha256, "b".repeat(64));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects snapshots with fewer than 1000 posts", () => {
  const snapshot = fixture();
  snapshot.posts.pop();
  assert.throws(() => validatePortfolioSnapshot(snapshot), /posts: expected exactly 1000 records/);
});

test("rejects duplicate IDs and mismatched sampled ID order", () => {
  const duplicate = fixture();
  duplicate.posts[999].source_id = duplicate.posts[0].source_id;
  assert.throws(() => validatePortfolioSnapshot(duplicate), /duplicate source_id/);

  const mismatch = fixture();
  mismatch.sampled_source_ids[0] = "different-source";
  assert.throws(() => validatePortfolioSnapshot(mismatch), /order does not match/);
});

test("rejects records missing canonical text or original Markdown", () => {
  const snapshot = fixture();
  snapshot.posts[0].body = " ";
  assert.throws(() => validatePortfolioSnapshot(snapshot), /posts\[0\]\.body/);
});

test("rejects active or cooldown exclusions included in the sample", () => {
  const snapshot = fixture();
  snapshot.sampled_source_ids[0] = "active-source";
  snapshot.posts[0].source_id = "active-source";
  assert.throws(() => validatePortfolioSnapshot(snapshot), /excluded source_id active-source/);
});

test("rejects malformed snapshot metadata", () => {
  const snapshot = fixture();
  snapshot.repository_commit = "not-a-commit";
  snapshot.content_sha256 = "bad";
  assert.throws(() => validatePortfolioSnapshot(snapshot), /repository_commit/);
});
