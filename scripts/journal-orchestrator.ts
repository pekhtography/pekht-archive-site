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
    reason: { type: "STRING" },
    facets: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["status", "candidate_id", "title", "description", "source_ids", "markdown", "reason", "facets"]
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

  if (!archive.length) {
    console.log("NO_JOURNAL: archive is empty.");
    return;
  }

  // Journal discovery works from a stratified sample of the current archive.
  // The archive is first put into the same deterministic A–Z order used by
  // the public Archive, then divided into TARGET_SAMPLE_SIZE contiguous zones.
  // Each zone contributes exactly one random representative. Thus every
  // part of the archive has equal probability of entering discovery.
  const TARGET_SAMPLE_SIZE = 1000;
  const MAX_DISCOVERY_ROUNDS = 2;

  function stratifiedSample(posts: ArchivePost[], target: number): ArchivePost[] {
    const ordered = [...posts].sort((a, b) => {
      const ka = a.body.match(/[\p{L}\p{N}]/u)?.index;
      const kb = b.body.match(/[\p{L}\p{N}]/u)?.index;
      const sa = ka === undefined ? a.body.toLocaleLowerCase() : a.body.slice(ka).toLocaleLowerCase();
      const sb = kb === undefined ? b.body.toLocaleLowerCase() : b.body.slice(kb).toLocaleLowerCase();
      return sa.localeCompare(sb) || a.source_id.localeCompare(b.source_id);
    });

    const sampleSize = Math.min(target, ordered.length);
    const sampled: ArchivePost[] = [];

    for (let i = 0; i < sampleSize; i += 1) {
      const start = Math.floor((i * ordered.length) / sampleSize);
      const end = Math.floor(((i + 1) * ordered.length) / sampleSize);
      const zone = ordered.slice(start, Math.max(start + 1, end));
      sampled.push(zone[Math.floor(Math.random() * zone.length)]);
    }

    return sampled;
  }

  const eligibleArchive = archive.filter((post) => !used.has(post.source_id));
  const sampled = stratifiedSample(eligibleArchive, TARGET_SAMPLE_SIZE);

  function compactSnapshot(posts: ArchivePost[], usedIds: Set<string>): string {
    return posts
      .filter((p) => !usedIds.has(p.source_id))
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

  const snapshot = compactSnapshot(sampled, used);
  if (!snapshot.trim()) {
    console.log("NO_JOURNAL: sampled archive snapshot is empty.");
    return;
  }

  const sourceMap = new Map(archive.map((p) => [p.source_id, p]));

  const scoreCandidate = (candidate: any) =>
    Object.values(candidate.scores ?? {}).reduce((sum: number, value: any) => sum + Number(value || 0), 0);

  const rankCandidates = (candidates: any[]) =>
    candidates
      .filter((candidate) => candidate && typeof candidate.id === "string")
      .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
      .slice(0, 3);

  const sourcesFor = (ids: string[]) => ids
    .map((id) => sourceMap.get(id))
    .filter(Boolean)
    .map((p: any) => `SOURCE_ID: ${p.source_id}\nTITLE: ${p.title}\nTEXT:\n${p.body}`)
    .join("\n\n---\n\n");

  let rejectedCandidateIds: string[] = [];

  for (let discoveryRound = 0; discoveryRound < MAX_DISCOVERY_ROUNDS; discoveryRound += 1) {
    const discoveryInstruction = rejectedCandidateIds.length
      ? `\n\nPREVIOUS CANDIDATES ALREADY REJECTED: ${rejectedCandidateIds.join(", ")}\nDo not return those candidates again. Find genuinely different alternatives from the supplied snapshot.`
      : "";

    const task1 = await generateJson(
      `${await prompt("task-1.md")}${discoveryInstruction}\n\nARCHIVE SNAPSHOT (STRATIFIED SAMPLE OF CURRENT ARCHIVE):\n${snapshot}`,
      task1Schema,
    );

    if (task1.status !== "OK" || !Array.isArray(task1.candidates)) {
      console.log("NO_JOURNAL: discovery found no viable candidates.");
      return;
    }

    const candidates = rankCandidates(task1.candidates);
    if (!candidates.length) {
      console.log("NO_JOURNAL: discovery found no viable candidates.");
      return;
    }

    // Keep rejected candidate IDs across discovery rounds so Stage 3 → Stage 1
    // cannot rediscover the same failed candidate set.
    // Stage 2 failures return to Stage 1, as required by the Journal state machine.
    // Stage 3 failures first try the next candidate from the current discovery.
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const selected = candidates[candidateIndex];

      let task2 = await generateJson(
        `${await prompt("task-2.md")}\n\nSELECTED CANDIDATE:\n${JSON.stringify(selected, null, 2)}\n\nSOURCE TEXTS:\n${sourcesFor(selected.source_ids)}`,
        task2Schema,
      );

      if (task2.status !== "OK") {
        rejectedCandidateIds.push(String(selected.id));
        console.log(`RETURN: TASK_2 rejected candidate ${selected.id}: ${task2.reason}`);
        break;
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
          rejectedCandidateIds.push(String(selected.id));
          console.log(`RETURN: revised TASK_2 rejected candidate ${selected.id}: ${task2.reason}`);
          break;
        }

        task3 = await generateJson(
          `${await prompt("task-3.md")}\n\nTASK 1 CANDIDATE:\n${JSON.stringify(selected, null, 2)}\n\nREVISED JOURNAL:\n${JSON.stringify(task2, null, 2)}\n\nSOURCE TEXTS:\n${sourcesFor(task2.source_ids)}`,
          task3Schema,
        );
      }

      if (task3.verdict === "STRONG") {
        const slugBase = String(task2.title || "journal")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) || "journal";
        const now = new Date();
        const date = String(now.getUTCDate()).padStart(2, "0") + "-" + String(now.getUTCMonth() + 1).padStart(2, "0") + "-" + now.getUTCFullYear();
        const slug = `${date}-${slugBase}`;

        function journalHeading(text: string): string {
          const plain = text
            .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
            .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
            .replace(/[#>*_~\`]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          const words = plain.split(" ").filter(Boolean);
          if (words.length <= 14) return plain;

          const targetMin = Math.min(10, words.length);
          const targetMax = Math.min(14, words.length);
          const boundaries = new Set([".", ",", ";", ":", "—", "–"]);
          const headingCandidates: { text: string; count: number; distance: number }[] = [];

          let position = 0;
          for (let i = 0; i < words.length; i += 1) {
            position += words[i].length + (i > 0 ? 1 : 0);
            if (i + 1 < targetMin || i + 1 > targetMax) continue;

            const nextChar = plain[position] ?? "";
            const endChar = words[i].slice(-1);
            if (boundaries.has(endChar) || boundaries.has(nextChar)) {
              headingCandidates.push({
                text: words.slice(0, i + 1).join(" "),
                count: i + 1,
                distance: Math.abs((i + 1) - 12),
              });
            }
          }

          if (headingCandidates.length > 0) {
            headingCandidates.sort((a, b) => a.distance - b.distance || a.count - b.count);
            return headingCandidates[0].text;
          }

          return words.slice(0, targetMax).join(" ") + "…";
        }

        const markdown = `---
draft: false
date: "${date}"
title: "${journalHeading(String(task2.markdown)).replace(/"/g, "\\\"")}"
description: "${String(task2.description).replace(/"/g, "\\\"")}"
category: "journal"
tags: ["archive"]
author: "PEKHTOGRAPHY"
source_ids: [${task2.source_ids.map((id: string) => JSON.stringify(id)).join(", ")}]
facets: [${(Array.isArray(task2.facets) ? task2.facets : []).map((facet: string) => JSON.stringify(facet)).join(", ")}]
---

${String(task2.markdown).trim()}
`;

        await writeFile(join(BLOG_DIR, `${slug}.md`), markdown, "utf8");
        console.log(`STRONG JOURNAL: ${slug}.md`);
        return;
      }

      rejectedCandidateIds.push(String(selected.id));
      console.log(`${task3.verdict}: candidate ${selected.id}: ${task3.reason}`);
    }

    if (!rejectedCandidateIds.length) break;
    console.log(`RETURN: discovery after candidate set exhausted. Round ${discoveryRound + 1}/${MAX_DISCOVERY_ROUNDS}.`);
  }

  console.log("NO_JOURNAL: all discovery/selection/validation paths exhausted.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
