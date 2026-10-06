import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateJson } from "./journal/provider.ts";

type ArchivePost = {
  source_id: string;
  x_id: string;
  title: string;
  body: string;
  hashtags: string[];
  created_at: string;
};

const ROOT = process.cwd();
const ARCHIVE_DIR = join(ROOT, "src/content/archive");
const BLOG_DIR = join(ROOT, "src/content/blog");

function frontmatter(text: string): Record<string, string | string[]> {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return {};
  const data: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try { data[key] = JSON.parse(raw.replace(/'/g, '"')); } catch { data[key] = []; }
    } else {
      data[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  data.__body = match[2].trim();
  return data;
}

async function loadArchive(): Promise<ArchivePost[]> {
  const names = (await readdir(ARCHIVE_DIR)).filter((n) => n.endsWith(".md"));
  const posts: ArchivePost[] = [];
  for (const name of names) {
    const raw = await readFile(join(ARCHIVE_DIR, name), "utf8");
    const fm = frontmatter(raw);
    const body = String(fm.__body ?? "").trim();
    const source_id = name.replace(/\.md$/, "");
    posts.push({
      source_id,
      x_id: String(fm.x_id ?? ""),
      title: String(fm.title ?? source_id),
      body,
      hashtags: Array.isArray(fm.hashtags) ? fm.hashtags.map(String) : [],
      created_at: String(fm.x_created_at ?? ""),
    });
  }
  return posts;
}

async function loadUsedSources(): Promise<Set<string>> {
  const used = new Set<string>();
  let names: string[] = [];
  try { names = (await readdir(BLOG_DIR)).filter((n) => n.endsWith(".md") || n.endsWith(".mdx")); } catch { return used; }
  for (const name of names) {
    const raw = await readFile(join(BLOG_DIR, name), "utf8");
    const fm = frontmatter(raw);
    if (fm.category !== "journal") continue;
    const ids = Array.isArray(fm.source_ids) ? fm.source_ids : [];
    ids.map(String).forEach((id) => used.add(id));
  }
  return used;
}

function compactSnapshot(posts: ArchivePost[], used: Set<string>): string {
  return posts
    .filter((p) => !used.has(p.source_id))
    .map((p) => [
      `SOURCE_ID: ${p.source_id}`,
      `X_ID: ${p.x_id}`,
      `DATE: ${p.created_at}`,
      `TITLE: ${p.title}`,
      `HASHTAGS: ${p.hashtags.join(" ")}`,
      `TEXT:\n${p.body}`,
    ].join("\n"))
    .join("\n\n---\n\n");
}

const task1Schema = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["OK", "NO_JOURNAL"] },
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          vector: { type: "STRING" },
          hero: { type: "STRING" },
          entry_id: { type: "STRING" },
          exit_id: { type: "STRING" },
          source_ids: { type: "ARRAY", items: { type: "STRING" } },
          emergent_whole: { type: "STRING" },
          evidence: { type: "ARRAY", items: { type: "STRING" } },
          scores: {
            type: "OBJECT",
            properties: {
              emergent_whole: { type: "NUMBER" },
              arc: { type: "NUMBER" },
              necessity: { type: "NUMBER" },
              minimality: { type: "NUMBER" },
              preservation: { type: "NUMBER" },
              ending: { type: "NUMBER" }
            },
            required: ["emergent_whole", "arc", "necessity", "minimality", "preservation", "ending"]
          }
        },
        required: ["id", "vector", "hero", "entry_id", "exit_id", "source_ids", "emergent_whole", "evidence", "scores"]
      }
    }
  },
  required: ["status", "candidates"]
};

const task2Schema = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["OK", "RETURN"] },
    candidate_id: { type: "STRING" },
    title: { type: "STRING" },
    description: { type: "STRING" },
    source_ids: { type: "ARRAY", items: { type: "STRING" } },
    markdown: { type: "STRING" },
    reason: { type: "STRING" }
  },
  required: ["status", "candidate_id", "title", "description", "source_ids", "markdown", "reason"]
};

const task3Schema = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["STRONG", "REVISION", "NO_JOURNAL"] },
    reason: { type: "STRING" },
    evidence: { type: "ARRAY", items: { type: "STRING" } },
    revision: { type: "STRING" }
  },
  required: ["verdict", "reason", "evidence", "revision"]
};

async function prompt(path: string): Promise<string> {
  return readFile(join(ROOT, "scripts/journal/prompts", path), "utf8");
}

async function run() {
  const archive = await loadArchive();
  const used = await loadUsedSources();
  const snapshot = compactSnapshot(archive, used);

  if (!snapshot.trim()) {
    console.log("NO_JOURNAL: archive snapshot is empty.");
    return;
  }

  const task1 = await generateJson(
    `${await prompt("task-1.md")}\n\nARCHIVE SNAPSHOT:\n${snapshot}`,
    task1Schema,
  );

  if (task1.status !== "OK" || !Array.isArray(task1.candidates) || task1.candidates.length === 0) {
    console.log("NO_JOURNAL");
    return;
  }

  const candidates = [...task1.candidates]
    .sort((a, b) => {
      const score = (c: any) => Object.values(c.scores ?? {}).reduce((s: number, v: any) => s + Number(v || 0), 0);
      return score(b) - score(a);
    })
    .slice(0, 3);

  const sourceMap = new Map(archive.map((p) => [p.source_id, p]));
  let selected = candidates[0];

  const sourcesFor = (ids: string[]) => ids
    .map((id) => sourceMap.get(id))
    .filter(Boolean)
    .map((p: any) => `SOURCE_ID: ${p.source_id}\nTITLE: ${p.title}\nTEXT:\n${p.body}`)
    .join("\n\n---\n\n");

  let task2 = await generateJson(
    `${await prompt("task-2.md")}\n\nSELECTED CANDIDATE:\n${JSON.stringify(selected, null, 2)}\n\nSOURCE TEXTS:\n${sourcesFor(selected.source_ids)}`,
    task2Schema,
  );

  if (task2.status !== "OK") {
    console.log(`RETURN: TASK_2 rejected candidate: ${task2.reason}`);
    return;
  }

  let task3 = await generateJson(
    `${await prompt("task-3.md")}\n\nTASK 1 CANDIDATE:\n${JSON.stringify(selected, null, 2)}\n\nTASK 2 JOURNAL:\n${JSON.stringify(task2, null, 2)}\n\nSOURCE TEXTS:\n${sourcesFor(task2.source_ids)}`,
    task3Schema,
  );

  if (task3.verdict === "REVISION") {
    task2 = await generateJson(
      `${await prompt("task-2.md")}\n\nREVISION REQUIRED:\n${task3.revision}\n\nSELECTED CANDIDATE:\n${JSON.stringify(selected, null, 2)}\n\nCURRENT MONTAGE:\n${JSON.stringify(task2, null, 2)}\n\nSOURCE TEXTS:\n${sourcesFor(selected.source_ids)}`,
      task2Schema,
    );
    if (task2.status !== "OK") {
      console.log(`NO_JOURNAL: revision could not be assembled: ${task2.reason}`);
      return;
    }
    task3 = await generateJson(
      `${await prompt("task-3.md")}\n\nTASK 1 CANDIDATE:\n${JSON.stringify(selected, null, 2)}\n\nREVISED JOURNAL:\n${JSON.stringify(task2, null, 2)}\n\nSOURCE TEXTS:\n${sourcesFor(task2.source_ids)}`,
      task3Schema,
    );
  }

  if (task3.verdict !== "STRONG") {
    console.log(`${task3.verdict}: ${task3.reason}`);
    return;
  }

  const slugBase = String(task2.title || "journal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "journal";
  const date = new Date().toISOString().slice(0, 10).split("-").reverse().join("-");
  const slug = `${date}-${slugBase}`;
  const markdown = `---
draft: false
date: "${date}"
title: "${String(task2.title).replace(/"/g, "\\\"")}"
description: "${String(task2.description).replace(/"/g, "\\\"")}"
category: "journal"
tags: ["archive"]
author: "PEKHTOGRAPHY"
source_ids: [${task2.source_ids.map((id: string) => JSON.stringify(id)).join(", ")}]
---

${String(task2.markdown).trim()}
`;

  await writeFile(join(BLOG_DIR, `${slug}.md`), markdown, "utf8");
  console.log(`STRONG JOURNAL: ${slug}.md`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
