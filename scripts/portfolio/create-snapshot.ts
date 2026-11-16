import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stratifiedSample } from "../../src/lib/stratified-sample.ts";
import {
  classifyLifecyclePublications,
  loadLifecycleRegistry,
  type LifecycleRegistry,
  type Publication,
} from "./lifecycle-registry.ts";
import {
  computePortfolioSnapshotContentHash,
  PORTFOLIO_SNAPSHOT_POST_COUNT,
  PORTFOLIO_SNAPSHOT_PURPOSE,
  validatePortfolioSnapshot,
  type PortfolioSnapshot,
  type PortfolioSnapshotPost,
} from "./snapshot.ts";

export interface ArchivePublication extends Publication {
  x_id: string;
  title: string;
  body: string;
  hashtags: string[];
  image: string;
  created_at: string;
  original_markdown: string;
}
export interface SnapshotBuildOptions {
  publications: ArchivePublication[];
  registry: LifecycleRegistry;
  now: Date;
  repositoryCommit: string;
  sample?: (posts: ArchivePublication[], target: number) => ArchivePublication[];
}
export interface SnapshotArchiveOptions {
  archiveDir?: string;
  registryPath?: string;
  outputPath?: string;
  now?: Date;
  repositoryCommit?: string;
  sample?: (posts: ArchivePublication[], target: number) => ArchivePublication[];
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed) as string; } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

/** Parses the archive's existing scalar frontmatter and block-list hashtags without changing source Markdown. */
export function parseArchivePublication(sourceId: string, raw: string): ArchivePublication {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`archive/${sourceId}: missing YAML frontmatter`);
  const lines = match[1].split(/\r?\n/);
  const fields = new Map<string, string>();
  const hashtags: string[] = [];
  let inHashtags = false;
  for (const line of lines) {
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (inHashtags && listItem) { hashtags.push(parseScalar(listItem[1])); continue; }
    const field = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!field) continue;
    inHashtags = field[1] === "hashtags";
    if (inHashtags) {
      const inline = field[2].trim();
      if (inline.startsWith("[") && inline.endsWith("]")) {
        const parsed = JSON.parse(inline.replace(/'/g, '"')) as unknown;
        if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
          throw new Error(`archive/${sourceId}: invalid inline hashtags`);
        }
        hashtags.push(...parsed);
      }
    } else fields.set(field[1], parseScalar(field[2]));
  }
  const body = match[2].trim();
  const required = ["x_id", "title", "image"] as const;
  for (const key of required) {
    if (!fields.get(key)?.trim()) throw new Error(`archive/${sourceId}: missing required frontmatter field ${key}`);
  }
  if (!body) throw new Error(`archive/${sourceId}: empty publication body`);
  const createdAt = fields.get("x_created_at") ?? fields.get("created_at") ?? "";
  if (createdAt && Number.isNaN(Date.parse(createdAt))) throw new Error(`archive/${sourceId}: invalid creation timestamp`);
  return {
    source_id: sourceId,
    x_id: fields.get("x_id") as string,
    title: fields.get("title") as string,
    body,
    hashtags,
    image: fields.get("image") as string,
    created_at: createdAt,
    original_markdown: raw,
  };
}

export function buildPortfolioSnapshot(options: SnapshotBuildOptions): PortfolioSnapshot {
  if (!/^[a-f0-9]{40}$/i.test(options.repositoryCommit)) {
    throw new Error("repositoryCommit: expected a 40-character Git commit SHA");
  }
  const classified = classifyLifecyclePublications(options.publications, options.registry, options.now);
  if (classified.eligiblePublications.length < PORTFOLIO_SNAPSHOT_POST_COUNT) {
    throw new Error(
      `Snapshot requires at least ${PORTFOLIO_SNAPSHOT_POST_COUNT} lifecycle-eligible archive publications; found ${classified.eligiblePublications.length}.`,
    );
  }
  const sampler = options.sample ?? stratifiedSample;
  // Critical ordering: sampling receives only the lifecycle-eligible pool.
  const sampled = sampler(classified.eligiblePublications, PORTFOLIO_SNAPSHOT_POST_COUNT);
  if (sampled.length !== PORTFOLIO_SNAPSHOT_POST_COUNT) {
    throw new Error(`sampler: expected exactly 1000 posts, received ${sampled.length}`);
  }
  const eligibleIds = new Set(classified.eligiblePublications.map((post) => post.source_id));
  const sampledIds = sampled.map((post) => post.source_id);
  if (new Set(sampledIds).size !== PORTFOLIO_SNAPSHOT_POST_COUNT ||
      sampled.some((post) => !eligibleIds.has(post.source_id))) {
    throw new Error("sampler: output contains duplicate or lifecycle-ineligible source IDs");
  }
  const posts: PortfolioSnapshotPost[] = sampled.map((post) => ({
    source_id: post.source_id,
    x_id: post.x_id,
    title: post.title,
    body: post.body,
    hashtags: [...post.hashtags],
    image: post.image,
    created_at: post.created_at,
    original_markdown: post.original_markdown,
  }));
  const snapshot: PortfolioSnapshot = {
    schema_version: 1,
    purpose: PORTFOLIO_SNAPSHOT_PURPOSE,
    generated_at: options.now.toISOString(),
    repository_commit: options.repositoryCommit,
    sampler: {
      function: "stratifiedSample",
      source_file: "src/lib/stratified-sample.ts",
      sort_function: "sortExploreItems",
      sort_source_file: "src/lib/explore-sort.ts",
      requested_count: PORTFOLIO_SNAPSHOT_POST_COUNT,
      random_seed: null,
      reproducibility: "Explore-order stratified sampling; the selected ordered content is frozen by the Snapshot SHA-256.",
    },
    archive_markdown_count: options.publications.length,
    active_gallery_exclusions: classified.activeGalleryExclusions,
    cooldown_exclusions: classified.cooldownExclusions,
    eligible_archive_count: classified.eligiblePublications.length,
    sampled_count: PORTFOLIO_SNAPSHOT_POST_COUNT,
    sampled_source_ids: sampledIds,
    content_sha256: "",
    posts,
  };
  snapshot.content_sha256 = computePortfolioSnapshotContentHash(snapshot);
  validatePortfolioSnapshot(snapshot);
  return snapshot;
}

export async function createPortfolioSnapshotFromArchive(options: SnapshotArchiveOptions = {}): Promise<PortfolioSnapshot> {
  const root = process.cwd();
  const archiveDir = options.archiveDir ?? join(root, "src/content/archive");
  const registryPath = options.registryPath ?? join(root, "scripts/portfolio/lifecycle-registry.json");
  const outputPath = options.outputPath ?? join(root, "snapshot/portfolio-snapshot.json");
  const names = (await readdir(archiveDir)).filter((name) => name.endsWith(".md")).sort((a, b) => a.localeCompare(b));
  const publications: ArchivePublication[] = [];
  for (const name of names) {
    const raw = await readFile(join(archiveDir, name), "utf8");
    publications.push(parseArchivePublication(name.replace(/\.md$/, ""), raw));
  }
  const registry = loadLifecycleRegistry(registryPath);
  const repositoryCommit = options.repositoryCommit ?? process.env.GITHUB_SHA;
  if (!repositoryCommit) throw new Error("repositoryCommit: provide options.repositoryCommit or GITHUB_SHA");
  const snapshot = buildPortfolioSnapshot({
    publications,
    registry,
    now: options.now ?? new Date(),
    repositoryCommit,
    ...(options.sample ? { sample: options.sample } : {}),
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return snapshot;
}

const isDirectExecution = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  createPortfolioSnapshotFromArchive().then((snapshot) => {
    console.log(JSON.stringify({
      status: "SNAPSHOT_CREATED",
      archive_markdown_count: snapshot.archive_markdown_count,
      active_gallery_exclusions: snapshot.active_gallery_exclusions.length,
      cooldown_exclusions: snapshot.cooldown_exclusions.length,
      eligible_count: snapshot.eligible_archive_count,
      sampled_count: snapshot.sampled_count,
      content_sha256: snapshot.content_sha256,
    }, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
