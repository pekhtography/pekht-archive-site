import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPortfolioSnapshot, createPortfolioSnapshotFromArchive, parseArchivePublication } from "./create-snapshot.ts";
import { computePortfolioSnapshotContentHash, validatePortfolioSnapshot } from "./snapshot.ts";
import type { LifecycleRegistry } from "./lifecycle-registry.ts";
import type { ArchivePublication } from "./create-snapshot.ts";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const COMMIT = "a".repeat(40);
function publication(id: string): ArchivePublication {
  const raw = `---\ntitle: "Title ${id}"\nx_id: "${id}"\nx_created_at: "2025-01-01T00:00:00Z"\nimage: "/images/${id}.jpg"\nhashtags:\n  - "Nature"\n  - "Light"\n---\nBody for ${id} #Nature\n`;
  return parseArchivePublication(id, raw);
}
function registry(active: string[] = [], cooldown: string[] = []): LifecycleRegistry {
  return {
    active_galleries: active.length ? [{
      gallery_id: "active-gallery",
      source_ids: active,
      created_at: "2026-10-01T00:00:00Z",
    }] : [],
    history: cooldown.length ? [{
      gallery_id: "history-gallery",
      source_ids: cooldown,
      created_at: "2026-08-01T00:00:00Z",
      removed_photos: cooldown.map((source_id) => ({
        source_id,
        removedFromExhibitionAt: "2026-11-01T12:00:00Z",
      })),
    }] : [],
  };
}
function archive(count: number): ArchivePublication[] {
  return Array.from({ length: count }, (_, index) => publication(`source-${String(index).padStart(4, "0")}`));
}
function deterministicSample(posts: ArchivePublication[], target: number): ArchivePublication[] {
  return posts.slice(0, target);
}

test("active gallery IDs are excluded and recorded only when present in the archive", () => {
  const publications = archive(1002);
  const snapshot = buildPortfolioSnapshot({
    publications, registry: registry(["source-0000", "not-in-archive"]), now: NOW,
    repositoryCommit: COMMIT, sample: deterministicSample,
  });
  assert.deepEqual(snapshot.active_gallery_exclusions, [{ gallery_id: "active-gallery", source_id: "source-0000" }]);
  assert.equal(snapshot.eligible_archive_count, 1001);
  assert.ok(!snapshot.sampled_source_ids.includes("source-0000"));
});

test("cooldown IDs are excluded and recorded using their latest removal event", () => {
  const publications = archive(1002);
  const snapshot = buildPortfolioSnapshot({
    publications, registry: registry([], ["source-0000"]), now: NOW,
    repositoryCommit: COMMIT, sample: deterministicSample,
  });
  assert.deepEqual(snapshot.cooldown_exclusions, [{ gallery_id: "history-gallery", source_id: "source-0000" }]);
  assert.equal(snapshot.eligible_archive_count, 1001);
  assert.ok(!snapshot.sampled_source_ids.includes("source-0000"));
});

test("empty registry produces empty exclusion arrays", () => {
  const snapshot = buildPortfolioSnapshot({
    publications: archive(1000), registry: registry(), now: NOW,
    repositoryCommit: COMMIT, sample: deterministicSample,
  });
  assert.deepEqual(snapshot.active_gallery_exclusions, []);
  assert.deepEqual(snapshot.cooldown_exclusions, []);
  assert.equal(snapshot.eligible_archive_count, 1000);
});

test("the sampler receives the filtered pool, not the complete archive", () => {
  const publications = archive(1004);
  const seen: string[] = [];
  const sample = (eligible: ArchivePublication[], target: number) => {
    seen.push(...eligible.map((post) => post.source_id));
    assert.equal(target, 1000);
    return eligible.slice(0, target);
  };
  const snapshot = buildPortfolioSnapshot({
    publications,
    registry: registry(["source-0000", "source-0001"], ["source-0002", "source-0003"]),
    now: NOW, repositoryCommit: COMMIT, sample,
  });
  assert.equal(seen.length, 1000);
  assert.ok(seen.every((id) => !["source-0000", "source-0001", "source-0002", "source-0003"].includes(id)));
  assert.equal(snapshot.eligible_archive_count, 1000);
  assert.equal(snapshot.sampled_count, 1000);
});

test("Snapshot SHA-256 is calculated from ordered sampled IDs and full post content", () => {
  const snapshot = buildPortfolioSnapshot({
    publications: archive(1000), registry: registry(), now: NOW,
    repositoryCommit: COMMIT, sample: deterministicSample,
  });
  assert.equal(snapshot.content_sha256, computePortfolioSnapshotContentHash(snapshot));
  assert.equal(validatePortfolioSnapshot(snapshot), true);
  const changed = structuredClone(snapshot);
  changed.posts[0].original_markdown += "\nchanged";
  assert.throws(() => validatePortfolioSnapshot(changed), /content_sha256: mismatch/);
});

test("refuses to create a 1000-post Snapshot if fewer than 1000 remain eligible", () => {
  assert.throws(() => buildPortfolioSnapshot({
    publications: archive(1000), registry: registry(["source-0000"]), now: NOW,
    repositoryCommit: COMMIT, sample: deterministicSample,
  }), /found 999/);
});

test("parser preserves original Markdown and extracts canonical text fields", () => {
  const raw = `---\ntitle: "A \"quoted\" title"\nx_id: "123"\nx_created_at: "2025-01-01T00:00:00Z"\nimage: "/image.jpg"\nhashtags:\n  - "Light"\n  - "Night"\n---\nFull body text.\n#Light\n`;
  const parsed = parseArchivePublication("fixture", raw);
  assert.equal(parsed.title, 'A "quoted" title');
  assert.deepEqual(parsed.hashtags, ["Light", "Night"]);
  assert.equal(parsed.original_markdown, raw);
  assert.equal(parsed.body, "Full body text.\n#Light");
});

test("archive command reads files and writes a validated Snapshot without provider calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "portfolio-create-snapshot-"));
  const archiveDir = join(root, "archive");
  const registryPath = join(root, "registry.json");
  const outputPath = join(root, "snapshot", "portfolio-snapshot.json");
  await mkdir(archiveDir, { recursive: true });
  try {
    const publications = archive(1000);
    for (const post of publications) await writeFile(join(archiveDir, `${post.source_id}.md`), post.original_markdown);
    await writeFile(registryPath, JSON.stringify(registry()), "utf8");
    const snapshot = await createPortfolioSnapshotFromArchive({
      archiveDir, registryPath, outputPath, now: NOW, repositoryCommit: COMMIT, sample: deterministicSample,
    });
    const stored = JSON.parse(await (await import("node:fs/promises")).readFile(outputPath, "utf8"));
    assert.equal(snapshot.content_sha256, stored.content_sha256);
    assert.equal(stored.posts.length, 1000);
    assert.equal(validatePortfolioSnapshot(stored), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
