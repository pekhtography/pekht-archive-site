import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const DIR = join(process.cwd(), "src/content/archive");
const nlp = winkNLP(model);
const its = nlp.its;
const STOP = new Set(["photography", "macro", "photo"]);
const TOP = 48;
const LAMBDA = 0.9;

type Post = { id: string; file: string; nouns: string[]; score: number };

function parse(s: string) {
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const fm = m?.[1] ?? "";
  return {
    id: fm.match(/^x_id:\s*["']?([^"']+)["']?\s*$/m)?.[1] ?? "",
    body: m?.[2] ?? s,
    tags: [...fm.matchAll(/^\s*-\s*["']?([^"']+)["']?\s*$/gm)].map(x => x[1]),
  };
}

function hashtags(s: string) {
  return s.replace(/#([A-Za-z0-9_]+)/g, (_, t: string) =>
    t.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"));
}

function nouns(s: string) {
  const d = nlp.readDoc(hashtags(s)).tokens();
  const v = d.out(its.value);
  const t = d.out(its.type);
  const l = d.out(its.lemma);
  const p = d.out(its.pos);

  return [...new Set(
    v.map((value, i) => ({ value, type: t[i], lemma: l[i], pos: p[i] }))
      .filter(x => x.type === "word" && (x.pos === "NOUN" || x.pos === "PROPN"))
      .map(x => (x.pos === "PROPN" ? x.value : x.lemma).toLocaleLowerCase())
      .filter(x => !STOP.has(x))
      .filter(Boolean)
  )];
}

const posts: Post[] = [];

for (const file of (await readdir(DIR)).filter(x => x.endsWith(".md")).sort()) {
  const x = parse(await readFile(join(DIR, file), "utf8"));
  posts.push({
    id: x.id,
    file,
    nouns: nouns(x.body + " " + x.tags.map(t => "#" + t).join(" ")),
    score: Infinity,
  });
}

// Merge a plural form only when its observed singular is also present.
const rawVocabulary = new Set(posts.flatMap(p => p.nouns));
for (const p of posts) {
  p.nouns = [...new Set(
    p.nouns.map(x =>
      x.length > 1 && x.endsWith("s") && rawVocabulary.has(x.slice(0, -1))
        ? x.slice(0, -1)
        : x
    )
  )];
}

// Global document-frequency ranking is the A2 relevance basis.
const df = new Map<string, number>();
for (const p of posts) {
  for (const x of p.nouns) df.set(x, (df.get(x) ?? 0) + 1);
}

const ranked = [...df.entries()].sort(
  (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
);
const rank = new Map(ranked.map(([x], i) => [x, i + 1]));

for (const p of posts) {
  p.score = p.nouns.length
    ? p.nouns.reduce((sum, x) => sum + (rank.get(x) ?? ranked.length), 0) / p.nouns.length
    : Infinity;
}

const a2 = [...posts].sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
const finite = a2.filter(p => Number.isFinite(p.score));
const lo = finite[0].score;
const hi = finite.at(-1)!.score;

function power8Relevance() {
  const out = new Map<string, number>();
  for (const p of a2) {
    if (!Number.isFinite(p.score)) {
      out.set(p.id, 0);
      continue;
    }
    const x = (hi - p.score) / (hi - lo || 1);
    out.set(p.id, Math.pow(x, 8));
  }
  return out;
}

function coverage(a: Post, b: Post, weights: Map<string, number>) {
  const concepts = new Set(b.nouns);
  let hit = 0;
  let total = 0;

  for (const x of a.nouns) {
    const weight = weights.get(x) ?? 1;
    total += weight;
    if (concepts.has(x)) hit += weight;
  }

  return total ? hit / total : 0;
}

function mmr(relevance: Map<string, number>) {
  const out: Post[] = [];
  const left = new Set(a2);
  const weights = new Map(ranked.map(([x], i) => [x, 1 / (i + 1)]));
  const maxRedundancy = new Map<string, number>();

  while (left.size) {
    let best: Post | undefined;
    let bestValue = -Infinity;

    for (const p of left) {
      const redundancy = maxRedundancy.get(p.id) ?? 0;
      const value =
        LAMBDA * (relevance.get(p.id) ?? 0) -
        (1 - LAMBDA) * redundancy;

      if (
        value > bestValue ||
        (
          value === bestValue &&
          (
            p.score < (best?.score ?? Infinity) ||
            (p.score === (best?.score ?? Infinity) && p.id < (best?.id ?? ""))
          )
        )
      ) {
        best = p;
        bestValue = value;
      }
    }

    if (!best) break;
    out.push(best);
    left.delete(best);

    for (const p of left) {
      const similarity = coverage(p, best, weights);
      if (similarity > (maxRedundancy.get(p.id) ?? 0)) {
        maxRedundancy.set(p.id, similarity);
      }
    }
  }

  return out;
}

function reportTop48(result: Post[]) {
  console.log("\n=== Explore v1 · Top 48 ===");
  for (const [i, p] of result.slice(0, TOP).entries()) {
    console.log(
      String(i + 1).padStart(2, "0"),
      "A2#" + String(a2.findIndex(x => x.id === p.id) + 1).padStart(4, "0"),
      p.score.toFixed(3),
      p.id,
      "=>",
      p.nouns.join(", ")
    );
  }
}

const relevance = power8Relevance();
const result = mmr(relevance);

console.log("Algorithm: Explore v1 — Rank MMR + Power8 relevance + lambda=0.90");
console.log("Archive posts:", posts.length, "Noun vocabulary:", ranked.length);
console.log("A2 baseline Top 48: 48 posts before diversity reranking");
console.log("Explore result:", result.length, "posts (full archive)");
reportTop48(result);
