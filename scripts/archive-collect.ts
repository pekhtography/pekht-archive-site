import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const username = "PEKHTOGRAPHY";
const contentDir = path.join(process.cwd(), "src", "content", "archive");

const extractXIds = (markdown: string) =>
  [...markdown.matchAll(/^x_id:\s*"?([0-9]+)"?\s*$/gm)].map((match) => match[1]);

const files = await fs.readdir(contentDir);
const archivedIds = new Set<string>();
for (const file of files.filter((name) => name.endsWith(".md"))) {
  const content = await fs.readFile(path.join(contentDir, file), "utf8");
  for (const id of extractXIds(content)) archivedIds.add(id);
}

if (archivedIds.size === 0) throw new Error("No archived x_id values found; refusing to run without a checkpoint.");

const checkpoint = [...archivedIds].reduce((max, id) =>
  BigInt(id) > BigInt(max) ? id : max,
);

console.log("");
console.log("PEKHTOGRAPHY incremental collector");
console.log("Archived posts: " + archivedIds.size);
console.log("Checkpoint: " + checkpoint);
console.log("");

console.log("Discovering X timeline with x-cli (Tier 2 session)...");
const { stdout } = await execFileAsync(
  "x",
  ["timeline", username, "--tier", "2", "--replies", "-o", "json", "-n", "5000"],
  { maxBuffer: 20 * 1024 * 1024 },
);

type TimelineRow = {
  id?: string;
  conversation_id?: string;
  url?: string;
};

const rows = JSON.parse(stdout) as TimelineRow[];

const discovered = [...new Set(
  rows
    .filter((row) => row.id && row.conversation_id && row.id === row.conversation_id)
    .map((row) => row.url?.trim())
    .filter((url): url is string =>
      Boolean(url) &&
      /^https?:\/\/(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+$/i.test(url),
    ),
)];

const candidates = discovered
  .map((url) => {
    const match = url.match(/\/status\/(\d+)$/i);
    return match ? { url, id: match[1] } : null;
  })
  .filter((item): item is { url: string; id: string } =>
    item !== null && BigInt(item.id) > BigInt(checkpoint) && !archivedIds.has(item.id),
  )
  .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);

console.log("Timeline rows: " + rows.length);
console.log("Discovered original-post URLs: " + discovered.length);
console.log("New candidates: " + candidates.length);
console.log("");

let imported = 0;
let failed = 0;

for (const candidate of candidates) {
  console.log("Importing " + candidate.id + ": " + candidate.url);
  try {
    await execFileAsync("pnpm", ["exec", "tsx", "scripts/archive-add.ts", candidate.url],
      { maxBuffer: 10 * 1024 * 1024 });
    imported += 1;
    console.log("Imported.");
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error("IMPORT ERROR: " + message);
  }
  console.log("");
}

console.log("Collector finished.");
console.log("Timeline rows: " + rows.length);
console.log("Discovered original-post URLs: " + discovered.length);
console.log("Already archived / below checkpoint: " + (discovered.length - candidates.length));
console.log("Candidates: " + candidates.length);
console.log("Imported: " + imported);
console.log("Failed: " + failed);

if (failed > 0) process.exitCode = 1;
