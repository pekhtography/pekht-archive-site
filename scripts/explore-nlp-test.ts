import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const ARCHIVE_DIR = join(process.cwd(), "src/content/archive");
const SAMPLE_SIZE = 100;
const nlp = winkNLP(model);
const its = nlp.its;

function parse(content: string) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const fm = m?.[1] ?? "";
  const body = m?.[2] ?? content;
  const id = fm.match(/^x_id:\s*["']?([^"']+)["']?\s*$/m)?.[1] ?? "";
  const tags = [...fm.matchAll(/^\s*-\s*["']?([^"']+)["']?\s*$/gm)].map(x => x[1]);
  return { id, body, tags };
}

function inspect(text: string) {
  const doc = nlp.readDoc(text);
  const tokens = doc.tokens();
  const values = tokens.out(its.value);
  const types = tokens.out(its.type);
  const lemmas = tokens.out(its.lemma);
  const pos = tokens.out(its.pos);

  return values.map((value, i) => ({
    value,
    type: types[i],
    lemma: lemmas[i],
    pos: pos[i],
  }));
}

const files = (await readdir(ARCHIVE_DIR)).filter(x => x.endsWith(".md")).sort();
const sampleFiles = files.slice(0, SAMPLE_SIZE);

const nounCounts = new Map<string, number>();
const examples: Array<{ file: string; nouns: string[] }> = [];

for (const file of sampleFiles) {
  const { body, tags } = parse(await readFile(join(ARCHIVE_DIR, file), "utf8"));
  const text = body + " " + tags.map(x => "#" + x).join(" ");
  const rows = inspect(text);
  const nouns = [...new Set(
    rows
      .filter(row => row.type === "word" && row.pos === "NOUN")
      .map(row => row.lemma.toLocaleLowerCase())
      .filter(Boolean)
  )];

  for (const noun of nouns) nounCounts.set(noun, (nounCounts.get(noun) ?? 0) + 1);
  examples.push({ file, nouns });
}

console.log("Archive posts:", files.length);
console.log("Sample posts:", sampleFiles.length);
console.log("Unique noun lemmas in sample:", nounCounts.size);
console.log("\nTop 30 noun lemmas in sample:");
for (const [i, [word, n]] of [...nounCounts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 30)
  .entries()) {
  console.log(String(i + 1).padStart(2, "0"), word, n);
}

console.log("\nFirst 20 sample posts — detected noun lemmas:");
for (const [i, item] of examples.slice(0, 20).entries()) {
  console.log(String(i + 1).padStart(2, "0"), item.file, "=>", item.nouns.join(", "));
}

console.log("\nTarget checks:");
for (const word of ["like", "one", "every", "while", "still", "flower", "flowers", "tree", "trees", "light", "love"]) {
  const rows = inspect(word);
  console.log(word, "=>", rows.map(row => `${row.lemma}/${row.pos}`).join(", "));
}
