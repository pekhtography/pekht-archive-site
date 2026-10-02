import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const DIR = join(process.cwd(), "src/content/archive");
const nlp = winkNLP(model);
const its = nlp.its;
const STOP = new Set(["photography", "macro", "photo"]);
const TOP = 48;
const LAMBDAS = [1.0, 0.9, 0.8, 0.7, 0.5, 0.3];

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
  const v = d.out(its.value), t = d.out(its.type), l = d.out(its.lemma), p = d.out(its.pos);
  return [...new Set(v.map((value, i) => ({value, type:t[i], lemma:l[i], pos:p[i]}))
    .filter(x => x.type === "word" && (x.pos === "NOUN" || x.pos === "PROPN"))
    .map(x => (x.pos === "PROPN" ? x.value : x.lemma).toLocaleLowerCase())
    .filter(x => !STOP.has(x)).filter(Boolean))];
}

const posts: Post[] = [];
for (const file of (await readdir(DIR)).filter(x => x.endsWith(".md")).sort()) {
  const x = parse(await readFile(join(DIR, file), "utf8"));
  posts.push({id:x.id, file, nouns:nouns(x.body + " " + x.tags.map(t => "#" + t).join(" ")), score:Infinity});
}

const raw = new Set(posts.flatMap(p => p.nouns));
for (const p of posts) p.nouns = [...new Set(p.nouns.map(x => x.endsWith("s") && raw.has(x.slice(0,-1)) ? x.slice(0,-1) : x))];

const df = new Map<string, number>();
for (const p of posts) for (const x of p.nouns) df.set(x, (df.get(x) ?? 0) + 1);
const ranked = [...df.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
const rank = new Map(ranked.map(([x],i) => [x,i+1]));
const idf = new Map(ranked.map(([x,n]) => [x, Math.log((posts.length+1)/(n+1))+1]));

for (const p of posts) p.score = p.nouns.length ? p.nouns.reduce((s,x) => s + (rank.get(x) ?? ranked.length),0)/p.nouns.length : Infinity;
const a2 = [...posts].sort((a,b) => a.score-b.score || a.id.localeCompare(b.id));
const finite = a2.filter(p => Number.isFinite(p.score));
const lo = finite[0].score, hi = finite.at(-1)!.score;
function normalizedRelevance(mode: string) {
  const out = new Map<string, number>();
  for (const p of a2) {
    if (!Number.isFinite(p.score)) {
      out.set(p.id, 0);
      continue;
    }
    if (mode === "minmax") {
      out.set(p.id, (hi - p.score) / (hi - lo || 1));
    } else if (mode === "power4") {
      out.set(p.id, Math.pow((hi - p.score) / (hi - lo || 1), 4));
    } else if (mode === "power8") {
      out.set(p.id, Math.pow((hi - p.score) / (hi - lo || 1), 8));
    } else if (mode === "inverse-sqrt") {
      const x = 1 / Math.sqrt(p.score);
      const xmin = 1 / Math.sqrt(hi);
      const xmax = 1 / Math.sqrt(lo);
      out.set(p.id, (x - xmin) / (xmax - xmin || 1));
    } else {
      throw new Error("Unknown relevance mode: " + mode);
    }
  }
  return out;
}
const relevanceModes = ["minmax", "power4", "power8", "inverse-sqrt"];

function coverage(a: Post, b: Post, w: Map<string,number>) {
  const bs = new Set(b.nouns);
  let hit=0,total=0;
  for (const x of a.nouns) { const q=w.get(x) ?? 1; total+=q; if(bs.has(x)) hit+=q; }
  return total ? hit/total : 0;
}
function jaccard(a: Post,b: Post) {
  const bs=new Set(b.nouns); let hit=0;
  for(const x of a.nouns) if(bs.has(x)) hit++;
  return hit/(new Set([...a.nouns,...b.nouns]).size)||0;
}
function mmr(sim:(a:Post,b:Post)=>number, lambda:number, rel: Map<string, number>, limit=TOP) {
  const out:Post[]=[]; const left=new Set(a2);
  while(out.length<limit && left.size) {
    let best:Post|undefined, bv=-Infinity;
    for(const p of left) {
      const red=out.length ? Math.max(...out.map(q=>sim(p,q))) : 0;
      const v=lambda*(rel.get(p.id)??0)-(1-lambda)*red;
      if(v>bv || (v===bv && (p.score<(best?.score??Infinity) || (p.score===(best?.score??Infinity)&&p.id<(best?.id??""))))) {best=p;bv=v;}
    }
    if(!best) break; out.push(best); left.delete(best);
  }
  return out;
}
function reportFull(name:string, r:Post[]) {
  console.log("\n=== FULL TOP 48 " + name + " ===");
  for(const [i,p] of r.entries()) console.log(String(i+1).padStart(2,"0"),"A2#"+String(a2.findIndex(x=>x.id===p.id)+1).padStart(4,"0"),p.score.toFixed(3),p.id,"=>",p.nouns.join(", "));
}

function reportBlocks(name:string, r:Post[], blockSize=TOP, blocks=4) {
  console.log("\n=== BLOCKS " + name + " ===");
  for (let b=0; b<blocks; b++) {
    const block=r.slice(b*blockSize,(b+1)*blockSize);
    if (!block.length) break;
    const concepts=new Set(block.flatMap(p=>p.nouns)); let pair=0,n=0;
    for(let i=0;i<block.length;i++) for(let j=i+1;j<block.length;j++){pair+=jaccard(block[i],block[j]);n++;}
    const pos=block.map(p=>a2.findIndex(x=>x.id===p.id)+1);
    console.log(
      "block", b+1,
      `(${b*blockSize+1}-${(b+1)*blockSize})`,
      "unique concepts:",concepts.size,
      "mean Jaccard:",(pair/n).toFixed(4),
      "A2 top48:",pos.filter(x=>x<=TOP).length+"/"+block.length,
      "mean A2 position:",(pos.reduce((a,x)=>a+x,0)/pos.length).toFixed(1),
      "A2 range:",Math.min(...pos)+"-"+Math.max(...pos)
    );
    for(const [i,p] of block.slice(0,5).entries()) console.log(
      String(i+1).padStart(2,"0"),
      "A2#"+String(a2.findIndex(x=>x.id===p.id)+1).padStart(4,"0"),
      p.score.toFixed(3),p.id,"=>",p.nouns.join(", ")
    );
  }
}

function report(name:string, r:Post[]) {
  const concepts=new Set(r.flatMap(p=>p.nouns)); let pair=0,n=0;
  for(let i=0;i<r.length;i++) for(let j=i+1;j<r.length;j++){pair+=jaccard(r[i],r[j]);n++;}
  const pos=r.map(p=>a2.findIndex(x=>x.id===p.id)+1);
  console.log("\n==="+name+"===");
  console.log("unique concepts:",concepts.size,"mean Jaccard:",(pair/n).toFixed(4),"A2 top48:",pos.filter(x=>x<=TOP).length+"/48","mean A2 position:",(pos.reduce((a,b)=>a+b,0)/pos.length).toFixed(1));
  for(const [i,p] of r.slice(0,20).entries()) console.log(String(i+1).padStart(2,"0"),"A2#"+String(a2.findIndex(x=>x.id===p.id)+1).padStart(4,"0"),p.score.toFixed(3),p.id,"=>",p.nouns.join(", "));
}

console.log("Algorithm: A3 MMR experiment");
console.log("Archive posts:",posts.length,"Noun vocabulary:",ranked.length);
report("A2 baseline",a2.slice(0,TOP));

console.log("\n=== Relevance transform audit ===");
for (const mode of relevanceModes) {
  const r = normalizedRelevance(mode);
  console.log(mode, [1, 10, 48, 100, 300, 500, 1000, 1500].map(n => (r.get(a2[n - 1].id) ?? 0).toFixed(6)).join(" "));
}

const rankW=new Map(ranked.map(([x],i)=>[x,1/(i+1)]));
const idfW=new Map(ranked.map(([x,n])=>[x,Math.log((posts.length+1)/(n+1))+1]));

for (const mode of relevanceModes) {
  const r = normalizedRelevance(mode);
  for (const l of [0.9, 0.8, 0.7]) {
    report("Rank MMR " + mode + " lambda=" + l, mmr((a,b)=>coverage(a,b,rankW),l,r));
  }
}
for (const l of [0.9, 0.8, 0.7]) {
  const r = normalizedRelevance("minmax");
  report("IDF MMR minmax lambda="+l,mmr((a,b)=>coverage(a,b,idfW),l,r));
}
report("Jaccard MMR minmax lambda=0.5",mmr(jaccard,0.5,normalizedRelevance("minmax")));

const power8Top48 = mmr((a,b)=>coverage(a,b,rankW),0.9,normalizedRelevance("power8"));
const inverseSqrtTop48 = mmr((a,b)=>coverage(a,b,rankW),0.9,normalizedRelevance("inverse-sqrt"));
const power8Top48_85 = mmr((a,b)=>coverage(a,b,rankW),0.85,normalizedRelevance("power8"));
const inverseSqrtTop48_85 = mmr((a,b)=>coverage(a,b,rankW),0.85,normalizedRelevance("inverse-sqrt"));
reportFull("Rank MMR power8 lambda=0.9", power8Top48);
reportFull("Rank MMR inverse-sqrt lambda=0.9", inverseSqrtTop48);
report("Rank MMR power8 lambda=0.85", power8Top48_85);
report("Rank MMR inverse-sqrt lambda=0.85", inverseSqrtTop48_85);
reportFull("Rank MMR power8 lambda=0.85", power8Top48_85);
reportFull("Rank MMR inverse-sqrt lambda=0.85", inverseSqrtTop48_85);

const power8Top192_90 = mmr((a,b)=>coverage(a,b,rankW),0.9,normalizedRelevance("power8"),192);
reportBlocks("Rank MMR power8 lambda=0.9", power8Top192_90, TOP, 4);
const inverseSqrtTop192_90 = mmr((a,b)=>coverage(a,b,rankW),0.9,normalizedRelevance("inverse-sqrt"),192);
reportBlocks("Rank MMR inverse-sqrt lambda=0.9", inverseSqrtTop192_90, TOP, 4);
