import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);
const its = nlp.its;
const STOP = new Set(["photography", "macro", "photo"]);
const LAMBDA = 0.9;

type ArchiveItem = { id: string; body: string; data?: { tags?: string[] } };
type ScoredItem<T> = {
  item: T;
  nouns: string[];
  score: number;
};

function hashtags(s: string) {
  return s.replace(/#([A-Za-z0-9_]+)/g, (_, tag: string) =>
    tag
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"),
  );
}

function nouns(s: string) {
  const d = nlp.readDoc(hashtags(s)).tokens();
  const values = d.out(its.value);
  const types = d.out(its.type);
  const lemmas = d.out(its.lemma);
  const poses = d.out(its.pos);

  return [
    ...new Set(
      values
        .map((value, i) => ({
          value,
          type: types[i],
          lemma: lemmas[i],
          pos: poses[i],
        }))
        .filter(
          (x) =>
            x.type === "word" &&
            (x.pos === "NOUN" || x.pos === "PROPN"),
        )
        .map((x) =>
          (x.pos === "PROPN" ? x.value : x.lemma).toLocaleLowerCase(),
        )
        .filter((x) => !STOP.has(x))
        .filter(Boolean),
    ),
  ];
}

function mergeObservedSingulars<T extends ArchiveItem>(
  posts: ScoredItem<T>[],
) {
  const rawVocabulary = new Set(posts.flatMap((post) => post.nouns));

  for (const post of posts) {
    post.nouns = [
      ...new Set(
        post.nouns.map((word) =>
          word.length > 1 &&
          word.endsWith("s") &&
          rawVocabulary.has(word.slice(0, -1))
            ? word.slice(0, -1)
            : word,
        ),
      ),
    ];
  }
}

function coverage<T>(
  a: ScoredItem<T>,
  b: ScoredItem<T>,
  weights: Map<string, number>,
) {
  const concepts = new Set(b.nouns);
  let hit = 0;
  let total = 0;

  for (const word of a.nouns) {
    const weight = weights.get(word) ?? 1;
    total += weight;
    if (concepts.has(word)) hit += weight;
  }

  return total ? hit / total : 0;
}

export function sortExploreItems<T extends ArchiveItem>(items: T[]): T[] {
  const posts: ScoredItem<T>[] = items.map((item) => ({
    item,
    nouns: nouns(`${item.body} ${(item.data?.tags ?? []).map((tag) => `#${tag}`).join(" ")}`),
    score: Infinity,
  }));

  mergeObservedSingulars(posts);

  const df = new Map<string, number>();
  for (const post of posts) {
    for (const word of post.nouns) {
      df.set(word, (df.get(word) ?? 0) + 1);
    }
  }

  const ranked = [...df.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const rank = new Map(ranked.map(([word], index) => [word, index + 1]));

  for (const post of posts) {
    post.score = post.nouns.length
      ? post.nouns.reduce(
          (sum, word) => sum + (rank.get(word) ?? ranked.length),
          0,
        ) / post.nouns.length
      : Infinity;
  }

  const a2 = [...posts].sort(
    (a, b) =>
      a.score - b.score || a.item.id.localeCompare(b.item.id),
  );
  const finite = a2.filter((post) => Number.isFinite(post.score));

  if (!finite.length) return items.slice();

  const lo = finite[0].score;
  const hi = finite.at(-1)!.score;

  const relevance = new Map<string, number>();
  for (const post of a2) {
    if (!Number.isFinite(post.score)) {
      relevance.set(post.item.id, 0);
      continue;
    }

    const x = (hi - post.score) / (hi - lo || 1);
    relevance.set(post.item.id, Math.pow(x, 8));
  }

  const weights = new Map(
    ranked.map(([word], index) => [word, 1 / (index + 1)]),
  );
  const left = new Set(a2);
  const result: ScoredItem<T>[] = [];
  const maxRedundancy = new Map<string, number>();

  while (left.size) {
    let best: ScoredItem<T> | undefined;
    let bestValue = -Infinity;

    for (const post of left) {
      const redundancy = maxRedundancy.get(post.item.id) ?? 0;
      const value =
        LAMBDA * (relevance.get(post.item.id) ?? 0) -
        (1 - LAMBDA) * redundancy;

      if (
        value > bestValue ||
        (value === bestValue &&
          (post.score < (best?.score ?? Infinity) ||
            (post.score === (best?.score ?? Infinity) &&
              post.item.id < (best?.item.id ?? ""))))
      ) {
        best = post;
        bestValue = value;
      }
    }

    if (!best) break;

    result.push(best);
    left.delete(best);

    for (const post of left) {
      const similarity = coverage(post, best, weights);
      if (similarity > (maxRedundancy.get(post.item.id) ?? 0)) {
        maxRedundancy.set(post.item.id, similarity);
      }
    }
  }

  return result.map((post) => post.item);
}
