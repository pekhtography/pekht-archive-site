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
  const id = fm.match(/^x_id:\s*["']?([^"']+)["']?\s*$/m)?.[1] ?? "";
  const tags = [...fm.matchAll(/^\s*-\s*["']?([^"']+)["']?\s*$/gm)].map(x => x[1]);
  return { id, body, tags };
}

const files = (await readdir(ARCHIVE_DIR)).filter(x => x.endsWith(".md")).sort();
const zero: any[] = [];
const reason = new Map<string, number>();
const posFreq = new Map<string, number>();
const wordLenFreq = new Map<number, number>();

for (const file of files) {
  const raw = await readFile(join(ARCHIVE_DIR, file), "utf8");
  const { id, body, tags } = parse(raw);
  const text = body + " " + tags.map(x => "#" + x).join(" ");
  const doc = nlp.readDoc(text);
  const tokens = doc.tokens();
  const values = tokens.out(its.value);
  const types = tokens.out(its.type);
  const pos = tokens.out(its.pos);
  const lemmas = tokens.out(its.lemma);
  const rows = values.map((value, i) => ({ value, type: types[i], pos: pos[i], lemma: lemmas[i] }))
    .filter(x => x.type === "word");

  const nounCount = rows.filter(x => x.pos === "NOUN").length;
  if (nounCount === 0) {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.pos] = (counts[r.pos] ?? 0) + 1;
      posFreq.set(r.pos, (posFreq.get(r.pos) ?? 0) + 1);
    }
    const signature = Object.entries(counts).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))
      .map(([p,n]) => `${p}:${n}`).join(",");
    reason.set(signature || "NO_WORD_TOKENS", (reason.get(signature || "NO_WORD_TOKENS") ?? 0) + 1);
    wordLenFreq.set(rows.length, (wordLenFreq.get(rows.length) ?? 0) + 1);
    zero.push({ id, file, body: body.trim(), tags, words: rows });
  }
}

console.log("ZERO-NOUN AUDIT");
console.log("Archive posts:", files.length);
console.log("Zero noun posts:", zero.length);
console.log("Percentage:", ((zero.length / files.length) * 100).toFixed(2) + "%");

console.log("\nReason signatures (word POS counts):");
for (const [k,n] of [...reason.entries()].sort((a,b)=>b[1]-a[1])) console.log(n, k);

console.log("\nPOS totals across zero-noun posts:");
for (const [k,n] of [...posFreq.entries()].sort((a,b)=>b[1]-a[1])) console.log(k, n);

console.log("\nWord-count distribution:");
for (const [k,n] of [...wordLenFreq.entries()].sort((a,b)=>a[0]-b[0])) console.log(k, n);

console.log("\nALL ZERO-NOUN POSTS:");
for (const [i,p] of zero.entries()) {
  console.log(`\n--- ${i+1}/${zero.length} | ${p.id} | ${p.file} ---`);
  console.log("TAGS:", p.tags.join(", "));
  console.log("BODY:", p.body);
  console.log("TOKENS:", p.words.map((w:any)=>`${w.value}/${w.pos}/${w.lemma}`).join(" "));
}
