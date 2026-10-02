import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const ARCHIVE_DIR = join(process.cwd(), "src/content/archive");
const nlp = winkNLP(model);
const its = nlp.its;

function parse(content: string) {
  const m = content.match(/^---\r?\n([\\s\\S]*?)\r?\n---\r?\n([\\s\\S]*)$/);
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

type Occ = { value: string; lemma: string; pos: string; file: string };
const occurrences: Occ[] = [];

for (const file of (await readdir(ARCHIVE_DIR)).filter(x => x.endsWith(".md")).sort()) {
  const { body, tags } = parse(await readFile(join(ARCHIVE_DIR, file), "utf8"));
  const doc = nlp.readDoc(normalizeHashtags(body + " " + tags.map(x => "#" + x).join(" ")));
  const tokens = doc.tokens();
  const values = tokens.out(its.value);
  const lemmas = tokens.out(its.lemma);
  const pos = tokens.out(its.pos);

  for (let i = 0; i < values.length; i++) {
    if (pos[i] === "NOUN" || pos[i] === "PROPN") {
      occurrences.push({
        value: values[i].toLocaleLowerCase(),
        lemma: lemmas[i].toLocaleLowerCase(),
        pos: pos[i],
        file,
      });
    }
  }
}

const nounLemmas = new Set(occurrences.filter(x => x.pos === "NOUN").map(x => x.lemma));
const propnValues = new Map<string, { count: number; lemmas: Set<string> }>();

for (const x of occurrences.filter(x => x.pos === "PROPN")) {
  const row = propnValues.get(x.value) ?? { count: 0, lemmas: new Set<string>() };
  row.count++;
  row.lemmas.add(x.lemma);
  propnValues.set(x.value, row);
}

const candidates = [...propnValues.entries()]
  .filter(([value, row]) => {
    if (!value.endsWith("s") || value.length < 4) return false;
    const singular = value.endsWith("es") ? value.slice(0, -2) : value.slice(0, -1);
    return nounLemmas.has(singular) || nounLemmas.has(value.slice(0, -1));
  })
  .map(([value, row]) => {
    const candidates = [value.endsWith("es") ? value.slice(0, -2) : "", value.slice(0, -1)]
      .filter(Boolean)
      .filter(x => nounLemmas.has(x));
    return { value, count: row.count, nounMatches: [...new Set(candidates)].join(", ") };
  })
  .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

console.log("PROPN plural-form candidates matching existing NOUN lemmas");
console.log("Candidate count:", candidates.length);
for (const x of candidates) console.log(x.value, x.count, "=>", x.nounMatches);

const dangerWords = ["glass","iris","moss","grass","class","bus","cactus","octopus","analysis"];
console.log("\nDanger-word audit");
for (const word of dangerWords) {
  const rows = occurrences.filter(x => x.value === word);
  const nouns = rows.filter(x => x.pos === "NOUN").length;
  const propns = rows.filter(x => x.pos === "PROPN").length;
  if (rows.length) console.log(word, "NOUN", nouns, "PROPN", propns, "total", rows.length);
}

const special = ["flowers","petals","trees","blossoms","blooms","colors","lights","clouds","birds","leaves","branches","roses","tulips"];
console.log("\nKnown-form audit");
for (const word of special) {
  const rows = occurrences.filter(x => x.value === word);
  if (rows.length) {
    const byPos = new Map<string, number>();
    for (const r of rows) byPos.set(r.pos, (byPos.get(r.pos) ?? 0) + 1);
    console.log(word, [...byPos.entries()].map(([p,n]) => p + ":" + n).join(", "), "lemmas:", [...new Set(rows.map(x => x.lemma))].join(", "));
  }
}
