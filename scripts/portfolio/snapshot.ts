import { readFile } from "node:fs/promises";
import type { PortfolioInputSnapshot } from "./validation/types.ts";

export const PORTFOLIO_SNAPSHOT_PURPOSE =
  "PEKHTography Portfolio Gemini v1.0 input snapshot";
export const PORTFOLIO_SNAPSHOT_POST_COUNT = 1000;

export interface PortfolioSnapshotPost {
  source_id: string;
  x_id: string;
  title: string;
  body: string;
  hashtags: string[];
  image: string;
  created_at: string;
  original_markdown: string;
}

export interface PortfolioSnapshotExclusion {
  gallery_id: string;
  source_id: string;
}

export interface PortfolioSnapshot {
  schema_version: 1;
  purpose: typeof PORTFOLIO_SNAPSHOT_PURPOSE;
  generated_at: string;
  repository_commit: string;
  sampler: {
    function: string;
    source_file: string;
    sort_function: string;
    sort_source_file: string;
    requested_count: number;
    random_seed: number | null;
    reproducibility: string;
  };
  archive_markdown_count: number;
  active_gallery_exclusions: PortfolioSnapshotExclusion[];
  cooldown_exclusions: PortfolioSnapshotExclusion[];
  eligible_archive_count: number;
  sampled_count: 1000;
  sampled_source_ids: string[];
  content_sha256: string;
  posts: PortfolioSnapshotPost[];
}

export interface LoadedPortfolioSnapshot {
  snapshot: PortfolioSnapshot;
  input_snapshot: PortfolioInputSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validateExclusions(
  value: unknown,
  field: string,
  errors: string[],
): value is PortfolioSnapshotExclusion[] {
  if (!Array.isArray(value)) {
    errors.push(`${field}: expected an array`);
    return false;
  }

  value.forEach((item, index) => {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.gallery_id) ||
      !isNonEmptyString(item.source_id)
    ) {
      errors.push(`${field}[${index}]: expected gallery_id and source_id`);
    }
  });

  return value.every(
    (item) =>
      isRecord(item) &&
      isNonEmptyString(item.gallery_id) &&
      isNonEmptyString(item.source_id),
  );
}

export function validatePortfolioSnapshot(
  value: unknown,
): value is PortfolioSnapshot {
  const errors: string[] = [];

  if (!isRecord(value)) {
    throw new Error("snapshot: expected a JSON object");
  }

  if (value.schema_version !== 1) errors.push("schema_version: expected 1");
  if (value.purpose !== PORTFOLIO_SNAPSHOT_PURPOSE) {
    errors.push("purpose: unexpected snapshot purpose");
  }
  if (!isIsoDate(value.generated_at)) errors.push("generated_at: expected an ISO date");
  if (
    !isNonEmptyString(value.repository_commit) ||
    !/^[a-f0-9]{40}$/i.test(value.repository_commit)
  ) {
    errors.push("repository_commit: expected a 40-character Git commit SHA");
  }
  if (!isRecord(value.sampler)) {
    errors.push("sampler: expected an object");
  } else {
    for (const field of [
      "function",
      "source_file",
      "sort_function",
      "sort_source_file",
      "reproducibility",
    ]) {
      if (!isNonEmptyString(value.sampler[field])) {
        errors.push(`sampler.${field}: expected a non-empty string`);
      }
    }
    if (value.sampler.requested_count !== PORTFOLIO_SNAPSHOT_POST_COUNT) {
      errors.push("sampler.requested_count: expected 1000");
    }
    if (
      value.sampler.random_seed !== null &&
      !Number.isInteger(value.sampler.random_seed)
    ) {
      errors.push("sampler.random_seed: expected an integer or null");
    }
  }

  if (!Number.isInteger(value.archive_markdown_count) || (value.archive_markdown_count as number) < 1) {
    errors.push("archive_markdown_count: expected a positive integer");
  }
  if (!Number.isInteger(value.eligible_archive_count) || (value.eligible_archive_count as number) < PORTFOLIO_SNAPSHOT_POST_COUNT) {
    errors.push("eligible_archive_count: expected an integer of at least 1000");
  }
  if (value.sampled_count !== PORTFOLIO_SNAPSHOT_POST_COUNT) {
    errors.push("sampled_count: expected exactly 1000");
  }
  if (!isSha256(value.content_sha256)) errors.push("content_sha256: expected a SHA-256 digest");

  validateExclusions(value.active_gallery_exclusions, "active_gallery_exclusions", errors);
  validateExclusions(value.cooldown_exclusions, "cooldown_exclusions", errors);

  const sampledIds = value.sampled_source_ids;
  if (
    !Array.isArray(sampledIds) ||
    sampledIds.length !== PORTFOLIO_SNAPSHOT_POST_COUNT ||
    !sampledIds.every(isNonEmptyString)
  ) {
    errors.push("sampled_source_ids: expected exactly 1000 non-empty source IDs");
  } else if (new Set(sampledIds).size !== PORTFOLIO_SNAPSHOT_POST_COUNT) {
    errors.push("sampled_source_ids: duplicate source IDs");
  }

  const posts = value.posts;
  if (!Array.isArray(posts) || posts.length !== PORTFOLIO_SNAPSHOT_POST_COUNT) {
    errors.push("posts: expected exactly 1000 records");
  } else {
    const postIds: string[] = [];
    posts.forEach((post, index) => {
      const path = `posts[${index}]`;
      if (!isRecord(post)) {
        errors.push(`${path}: expected an object`);
        return;
      }
      for (const field of [
        "source_id",
        "x_id",
        "title",
        "body",
        "image",
        "created_at",
        "original_markdown",
      ]) {
        if (!isNonEmptyString(post[field])) {
          errors.push(`${path}.${field}: expected a non-empty string`);
        }
      }
      if (!Array.isArray(post.hashtags) || !post.hashtags.every((tag) => typeof tag === "string")) {
        errors.push(`${path}.hashtags: expected an array of strings`);
      }
      if (isNonEmptyString(post.source_id)) postIds.push(post.source_id);
      if (isNonEmptyString(post.created_at) && !isIsoDate(post.created_at)) {
        errors.push(`${path}.created_at: expected an ISO date`);
      }
    });

    if (postIds.length === PORTFOLIO_SNAPSHOT_POST_COUNT) {
      if (new Set(postIds).size !== PORTFOLIO_SNAPSHOT_POST_COUNT) {
        errors.push("posts: duplicate source_id values");
      }
      if (
        Array.isArray(sampledIds) &&
        sampledIds.length === PORTFOLIO_SNAPSHOT_POST_COUNT &&
        postIds.some((id, index) => id !== sampledIds[index])
      ) {
        errors.push("posts: source_id order does not match sampled_source_ids");
      }
    }
  }

  const excludedIds = new Set<string>();
  for (const list of [value.active_gallery_exclusions, value.cooldown_exclusions]) {
    if (Array.isArray(list)) {
      for (const item of list) {
        if (isRecord(item) && isNonEmptyString(item.source_id)) {
          if (excludedIds.has(item.source_id)) {
            errors.push(`exclusions: duplicate source_id ${item.source_id}`);
          }
          excludedIds.add(item.source_id);
        }
      }
    }
  }
  if (Array.isArray(sampledIds)) {
    for (const id of sampledIds) {
      if (excludedIds.has(id)) errors.push(`sampled_source_ids: excluded source_id ${id}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Portfolio snapshot:\n- ${errors.join("\n- ")}`);
  }

  return true;
}

/**
 * Reads a previously generated Portfolio snapshot. This function performs no
 * network requests and never invokes a model provider.
 */
export async function readPortfolioSnapshot(
  filePath: string,
): Promise<LoadedPortfolioSnapshot> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read Portfolio snapshot at ${filePath}: ${detail}`);
  }

  validatePortfolioSnapshot(parsed);
  const snapshot = parsed as PortfolioSnapshot;

  return {
    snapshot,
    input_snapshot: {
      schema_version: String(snapshot.schema_version),
      repository_commit: snapshot.repository_commit,
      generated_at: snapshot.generated_at,
      sampled_count: PORTFOLIO_SNAPSHOT_POST_COUNT,
      content_sha256: snapshot.content_sha256,
    },
  };
}
