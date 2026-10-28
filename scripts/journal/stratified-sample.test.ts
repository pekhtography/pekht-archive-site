import assert from "node:assert/strict";
import { test } from "node:test";
import { sortExploreItems } from "../../src/lib/explore-sort.ts";
import { stratifiedSample, type StratifiedSamplePost } from "../../src/lib/stratified-sample.ts";

type TestPost = StratifiedSamplePost & { marker: number };

function makePosts(count: number): TestPost[] {
  return Array.from({ length: count }, (_, index) => ({
    source_id: `source-${String(index).padStart(4, "0")}`,
    body: `A distinct archive observation about object ${index} and its surroundings.`,
    hashtags: [],
    marker: index,
  }));
}

test("returns an empty sample for an empty input", () => {
  assert.deepEqual(stratifiedSample([], 1000), []);
});

test("returns every available post when fewer than target remain", () => {
  const posts = makePosts(12);
  const sample = stratifiedSample(posts, 1000);

  assert.equal(sample.length, posts.length);
  assert.equal(new Set(sample.map((post) => post.source_id)).size, posts.length);
  assert.ok(sample.every((post) => posts.includes(post)));
});

test("returns exactly target posts when input equals target", () => {
  const posts = makePosts(8);
  const sample = stratifiedSample(posts, 8);

  assert.equal(sample.length, 8);
  assert.equal(new Set(sample.map((post) => post.source_id)).size, 8);
  assert.ok(sample.every((post) => posts.includes(post)));
});

test("returns target posts when more than target remain", () => {
  const posts = makePosts(24);
  const sample = stratifiedSample(posts, 6);

  assert.equal(sample.length, 6);
  assert.equal(new Set(sample.map((post) => post.source_id)).size, 6);
  assert.ok(sample.every((post) => posts.includes(post)));
});


test("selects one representative from each contiguous Explore zone", () => {
  const posts = makePosts(24);
  const target = 6;
  const explored = sortExploreItems(
    posts.map((post) => ({
      id: post.source_id,
      body: post.body,
      data: { tags: post.hashtags },
      post,
    })),
  ).map((item) => item.post);

  const originalRandom = Math.random;
  let sample: TestPost[];

  try {
    // Select the first item in each zone so zone boundaries are testable.
    Math.random = () => 0;
    sample = stratifiedSample(posts, target);
  } finally {
    Math.random = originalRandom;
  }

  const expected = Array.from(
    { length: target },
    (_, index) => explored[Math.floor((index * explored.length) / target)],
  );

  assert.deepEqual(
    sample.map((post) => post.source_id),
    expected.map((post) => post.source_id),
  );
  assert.equal(new Set(sample.map((post) => post.source_id)).size, target);
});
