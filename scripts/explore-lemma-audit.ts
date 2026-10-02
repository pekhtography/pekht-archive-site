import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const ARCHIVE_DIR = join(process.cwd(), "src/content/archive");
const nlp = winkNLP(model);
const its = nlp.its;

function parse(content: string) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const fm = m?.[1] ?? "";
  const body = m?.[2] ?? content;
  const tags = [...fm.matchAll(/^\s*-\s*["']?([^"']+)["']?\s*$/gm)].map(x => x[1]);
  return { body, tags };
}

function normalizeHashtags(text: string): string {
  return text.replace(/#([A-Za-z0-9_]+)/g, (_, tag: string) =>
    tag.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
  );
}

const target = new Set(["flower", "flowers", "petal", "petals", "tree", "trees", "leaf", "leaves"]);

const stats = new Map<string, number>();
const byForm = new Map<string, number>();
const files = (await readdir(ARCHIVE_DIR)).filter(x => x.endsWith(".md"));

for (const file of files) {
  const { body, tags } = parse(await readFile(join(ARCHIVE_DIR, file), "utf8"));
  const doc = nlp.readDoc(normalizeHashtags(body + " " + tags.map(x => "#" + x).join(" ")));
  const values = doc.tokens().out(its.value);
  const lemmas = doc.tokens().out(its.lemma);
  const pos = doc.tokens().out(its.pos);

  for (let i = 0; i < values.length; i++) {
    const value = values[i].toLowerCase();
    if (!target.has(value)) continue;
    const key = `${value} → ${lemmas[i].toLowerCase()} / ${pos[i]}`;
    stats.set(key, (stats.get(key) ?? 0) + 1);
    byForm.set(value, (byForm.get(value) ?? 0) + 1);
  }
}

console.log("Token → lemma / POS audit");
for (const key of [...stats.keys()].sort()) {
  console.log(String(stats.get(key)).padStart(6), key);
}
console.log("\nRaw token totals:");
for (const word of [...target].sort()) {
  console.log(String(byForm.get(word) ?? 0).padStart(6), word);
}
