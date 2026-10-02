import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ARCHIVE_DIR = join(process.cwd(), "src/content/archive");
const STOP_WORDS = new Set(["a","an","and","are","as","at","be","been","but","by","can","could","did","do","does","for","from","had","has","have","he","her","here","hers","him","his","how","i","if","in","into","is","it","its","just","me","more","most","my","no","not","of","on","or","our","out","she","so","some","than","that","the","their","them","then","there","these","they","this","those","through","to","too","up","was","we","were","what","when","where","which","who","why","will","with","you","your","photo","photography","photos","photograph","image","images"]);

function parse(content: string) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const fm = m?.[1] ?? "";
  const body = m?.[2] ?? content;
  const id = fm.match(/^x_id:\s*["']?([^"']+)["']?\s*$/m)?.[1] ?? "";
  const tags = [...fm.matchAll(/^\s*-\s*["']?([^"']+)["']?\s*$/gm)].map(x => x[1]);
  return { id, body, tags };
}

function tokens(text: string) {
  return [...new Set(text.split(/\s+/u).map(x => x.toLocaleLowerCase().replace(/^#+/, "").replace(/[^\p{L}\p{N}]+/gu, "")).filter(x => x && !STOP_WORDS.has(x)))];
}

const files = (await readdir(ARCHIVE_DIR)).filter(x => x.endsWith(".md")).sort();
const posts = [];
const df = new Map<string, number>();

for (const file of files) {
  const { id, body, tags } = parse(await readFile(join(ARCHIVE_DIR, file), "utf8"));
  const words = tokens(body + " " + tags.map(x => "#" + x).join(" "));
  for (const word of words) df.set(word, (df.get(word) ?? 0) + 1);
  posts.push({ id, file, body, words });
}

const ranked = [...df.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const rank = new Map(ranked.map(([word], i) => [word, i + 1]));

const scored = posts.map(p => ({
  ...p,
  score: p.words.length ? p.words.reduce((s,w) => s + (rank.get(w) ?? ranked.length), 0) / p.words.length : Infinity
})).sort((a,b) => a.score - b.score || a.id.localeCompare(b.id));

console.log("Archive posts:", posts.length);
console.log("Vocabulary size:", ranked.length);
console.log("Top 100 words:");
for (const [i, [word, n]] of ranked.slice(0, 100).entries()) {
  console.log(String(i + 1).padStart(3, "0"), word, n);
}
console.log("\nTop 48 Explore results:");
for (const [i, p] of scored.slice(0, 48).entries()) console.log(String(i+1).padStart(2,"0"), p.score.toFixed(3), p.id, p.file);
