import { sortExploreItems } from "./explore-sort.ts";

export type StratifiedSamplePost = {
  source_id: string;
  body: string;
  hashtags: string[];
};

/**
 * Sort archive posts using the Explore sequence, then select one random
 * representative from each of up to `target` contiguous zones.
 *
 * Filtering is the caller's responsibility and must happen before this call.
 */
export function stratifiedSample<T extends StratifiedSamplePost>(
  posts: T[],
  target: number,
): T[] {
  const exploreInput = posts.map((post) => ({
    id: post.source_id,
    body: post.body,
    data: { tags: post.hashtags },
    post,
  }));

  const explored = sortExploreItems(exploreInput).map(
    (item) => item.post,
  );

  const sampleSize = Math.min(target, explored.length);
  const sampled: T[] = [];

  for (let i = 0; i < sampleSize; i += 1) {
    const start = Math.floor(
      (i * explored.length) / sampleSize,
    );
    const end = Math.floor(
      ((i + 1) * explored.length) / sampleSize,
    );

    const zone = explored.slice(
      start,
      Math.max(start + 1, end),
    );

    sampled.push(
      zone[Math.floor(Math.random() * zone.length)],
    );
  }

  return sampled;
}
