import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const ARCHIVE_DIR = join(process.cwd(), "src/content/archive");
const nlp = winkNLP(model);
const its = nlp.its;
const technicalStopWords = new Set(["photography", "macro", "photo"]);

function parse(content: string) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const fm = m?.[1] ?? "";
  const body = m?.[2] ?? content;
  const id = fm.match(/^x_id:\s*["']?([^"']+)["']?\s*$/m)?.[1] ?? "";
  const tags = [...fm.matchAll(/^\s*-\s*["']?([^"']+)["']?\s*$/gm)].map(x => x[1]);
  return { id, body, tags };
}

function normalizeHashtags(text: string): string {
  return text.replace(/#([A-Za-z0-9_]+)/g, (_, tag: string) =>
    tag.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
  );
}

function nounLemmas(text: string): string[] {
  const doc = nlp.readDoc(normalizeHashtags(text));
  const tokens = doc.tokens();
  const values = tokens.out(its.value);
  const types = tokens.out(its.type);
  const lemmas = tokens.out(its.lemma);
  const pos = tokens.out(its.pos);

  return [...new Set(
    values
      .map((value, i) => ({ value, type: types[i], lemma: lemmas[i], pos: pos[i] }))
      .filter(row => row.type === "word" && (row.pos === "NOUN" || row.pos === "PROPN"))
      .map(row => (row.pos === "PROPN" ? row.value : row.lemma).toLocaleLowerCase())
      .filter(lemma => !technicalStopWords.has(lemma))
      .filter(Boolean)
  )];
}

const files = (await readdir(ARCHIVE_DIR)).filter(x => x.endsWith(".md")).sort();
const posts: Array<{ id: string; file: string; nouns: string[] }> = [];

for (const file of files) {
  const { id, body, tags } = parse(await readFile(join(ARCHIVE_DIR, file), "utf8"));
  posts.push({
    id,
    file,
    nouns: nounLemmas(body + " " + tags.map(x => "#" + x).join(" ")),
  });
}

const rawNounVocabulary = new Set(posts.flatMap(post => post.nouns));

function mergeWithObservedSingular(lemma: string): string {
  if (lemma.length > 1 && lemma.endsWith("s")) {
    const singular = lemma.slice(0, -1);
    if (rawNounVocabulary.has(singular)) return singular;
  }
  return lemma;
}

for (const post of posts) {
  post.nouns = [...new Set(post.nouns.map(mergeWithObservedSingular))];
}

const df = new Map<string, number>();
for (const post of posts) {
  for (const noun of post.nouns) df.set(noun, (df.get(noun) ?? 0) + 1);
}

const ranked = [...df.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const rank = new Map(ranked.map(([word], i) => [word, i + 1]));

const scored = posts
  .map(post => ({
    ...post,
    score: post.nouns.length
      ? post.nouns.reduce((sum, word) => sum + (rank.get(word) ?? ranked.length), 0) / post.nouns.length
      : Infinity,
  }))
  .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));

const zeroNounPosts = scored.filter(post => post.nouns.length === 0).length;

console.log("Algorithm: A2");
console.log("Archive posts:", posts.length);
console.log("Noun vocabulary size:", ranked.length);
console.log("Posts with zero noun lemmas:", zeroNounPosts);

console.log("\nTop 100 noun lemmas:");
for (const [i, [word, n]] of ranked.slice(0, 100).entries()) {
  console.log(String(i + 1).padStart(3, "0"), word, n);
}

console.log("\nTop 48 Explore A2 results:");
for (const [i, post] of scored.slice(0, 48).entries()) {
  console.log(
    String(i + 1).padStart(2, "0"),
    Number.isFinite(post.score) ? post.score.toFixed(3) : "INF",
    post.id,
    post.file,
    "=>",
    post.nouns.join(", ")
  );
}
