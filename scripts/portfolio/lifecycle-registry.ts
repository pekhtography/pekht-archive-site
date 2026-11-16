import { readFileSync } from "node:fs";

export const PORTFOLIO_COOLDOWN_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RemovedPhoto {
  source_id: string;
  removedFromExhibitionAt: string;
}

export interface GalleryRecord {
  gallery_id: string;
  source_ids: string[];
  created_at: string;
  replaced_at?: string;
  removed_photos?: RemovedPhoto[];
}

export interface LifecycleRegistry {
  active_galleries: GalleryRecord[];
  history: GalleryRecord[];
}

export interface Publication {
  source_id: string;
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTimestamp(value: unknown, field: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw new Error(`${field}: expected an ISO-8601 timestamp with timezone`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${field}: invalid timestamp`);
  }
  return timestamp;
}

function validateGallery(value: unknown, path: string): GalleryRecord {
  if (!isObject(value)) throw new Error(`${path}: expected an object`);
  if (!nonEmptyString(value.gallery_id)) throw new Error(`${path}.gallery_id: expected a non-empty string`);
  if (!Array.isArray(value.source_ids) || !value.source_ids.every(nonEmptyString)) {
    throw new Error(`${path}.source_ids: expected an array of non-empty strings`);
  }
  if (new Set(value.source_ids).size !== value.source_ids.length) {
    throw new Error(`${path}.source_ids: duplicate source IDs`);
  }
  parseTimestamp(value.created_at, `${path}.created_at`);
  if (value.replaced_at !== undefined) parseTimestamp(value.replaced_at, `${path}.replaced_at`);

  let removedPhotos: RemovedPhoto[] | undefined;
  if (value.removed_photos !== undefined) {
    if (!Array.isArray(value.removed_photos)) {
      throw new Error(`${path}.removed_photos: expected an array`);
    }
    const seen = new Set<string>();
    removedPhotos = value.removed_photos.map((item, index) => {
      const itemPath = `${path}.removed_photos[${index}]`;
      if (!isObject(item) || !nonEmptyString(item.source_id)) {
        throw new Error(`${itemPath}.source_id: expected a non-empty string`);
      }
      if (typeof item.removedFromExhibitionAt !== "string" || !item.removedFromExhibitionAt.trim()) {
        throw new Error(`${itemPath}.removedFromExhibitionAt: required timestamp is missing`);
      }
      parseTimestamp(item.removedFromExhibitionAt, `${itemPath}.removedFromExhibitionAt`);
      if (!value.source_ids.includes(item.source_id)) {
        throw new Error(`${itemPath}.source_id: not present in gallery source_ids`);
      }
      if (seen.has(item.source_id)) {
        throw new Error(`${itemPath}.source_id: duplicate removal event in gallery`);
      }
      seen.add(item.source_id);
      return {
        source_id: item.source_id,
        removedFromExhibitionAt: item.removedFromExhibitionAt,
      };
    });
  }

  return {
    gallery_id: value.gallery_id,
    source_ids: [...value.source_ids] as string[],
    created_at: value.created_at as string,
    ...(value.replaced_at === undefined ? {} : { replaced_at: value.replaced_at as string }),
    ...(removedPhotos === undefined ? {} : { removed_photos: removedPhotos }),
  };
}

export function validateLifecycleRegistry(value: unknown): LifecycleRegistry {
  if (!isObject(value)) throw new Error("lifecycle registry: expected a JSON object");
  if (!Array.isArray(value.active_galleries)) {
    throw new Error("active_galleries: expected an array");
  }
  if (!Array.isArray(value.history)) throw new Error("history: expected an array");

  const active_galleries = value.active_galleries.map((item, index) =>
    validateGallery(item, `active_galleries[${index}]`),
  );
  const history = value.history.map((item, index) =>
    validateGallery(item, `history[${index}]`),
  );

  const activeIds = new Set<string>();
  for (const gallery of active_galleries) {
    for (const sourceId of gallery.source_ids) {
      if (activeIds.has(sourceId)) {
        throw new Error(`active_galleries: source_id ${sourceId} appears in more than one active gallery`);
      }
      activeIds.add(sourceId);
    }
  }
  return { active_galleries, history };
}

/** Loads and validates the persistent lifecycle registry synchronously. */
export function loadLifecycleRegistry(path: string): LifecycleRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load lifecycle registry at ${path}: ${detail}`);
  }
  return validateLifecycleRegistry(parsed);
}

/**
 * Preserves archive order. Active photos are always excluded; historical
 * removal events use the latest exit timestamp for each source_id. At the
 * exact 60-day instant a photo becomes eligible again.
 */
export function filterEligiblePublications<T extends Publication>(
  allPublications: T[],
  registry: LifecycleRegistry,
  now: Date,
): T[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("now: invalid Date");

  const validated = validateLifecycleRegistry(registry);
  const activeIds = new Set(validated.active_galleries.flatMap((gallery) => gallery.source_ids));
  const latestRemoval = new Map<string, number>();

  for (const gallery of validated.history) {
    const events = gallery.removed_photos ??
      (gallery.replaced_at
        ? gallery.source_ids.map((source_id) => ({
            source_id,
            removedFromExhibitionAt: gallery.replaced_at as string,
          }))
        : []);

    for (const event of events) {
      const removedAt = parseTimestamp(
        event.removedFromExhibitionAt,
        `history[${gallery.gallery_id}].removed_photos[${event.source_id}].removedFromExhibitionAt`,
      );
      if (removedAt > nowMs) {
        throw new Error(`removedFromExhibitionAt for source_id ${event.source_id} is in the future`);
      }
      const previous = latestRemoval.get(event.source_id);
      if (previous === undefined || removedAt > previous) {
        latestRemoval.set(event.source_id, removedAt);
      }
    }
  }

  return allPublications.filter((publication) => {
    if (!nonEmptyString(publication.source_id)) {
      throw new Error("publication.source_id: expected a non-empty string");
    }
    if (activeIds.has(publication.source_id)) return false;
    const removedAt = latestRemoval.get(publication.source_id);
    return removedAt === undefined || nowMs >= removedAt + PORTFOLIO_COOLDOWN_DAYS * DAY_MS;
  });
}
