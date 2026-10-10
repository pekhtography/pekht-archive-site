import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sortExploreItems } from "../src/lib/explore-sort.ts";
import { generateJson } from "./journal/provider.ts";
import { validateMontage } from "./journal/montage-validation.ts";
import {
  formatRejectionSummary,
  recordRejection,
  type RejectionReasons,
  type RejectionStage,
} from "./journal/rejection-reasons.ts";

type ArchivePost = {
  source_id: string;
  x_id: string;
  title: string;
  body: string;
  hashtags: string[];
  image: string;
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
      try {
        data[key] = JSON.parse(raw.replace(/'/g, '"'));
      } catch {
        data[key] = [];
      }
    } else {
      data[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  data.__body = match[2].trim();
  return data;
}

async function loadArchive(): Promise<ArchivePost[]> {
  const names = (await readdir(ARCHIVE_DIR)).filter((n) =>
    n.endsWith(".md"),
  );

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
      hashtags: Array.isArray(fm.hashtags)
        ? fm.hashtags.map(String)
        : [],
      image: String(fm.image ?? ""),
      created_at: String(fm.x_created_at ?? ""),
    });
  }

  return posts;
}

async function loadUsedSources(): Promise<Set<string>> {
  const used = new Set<string>();
  let names: string[] = [];

  try {
    names = (await readdir(BLOG_DIR)).filter(
      (n) => n.endsWith(".md") || n.endsWith(".mdx"),
    );
  } catch {
    return used;
  }

  for (const name of names) {
    const raw = await readFile(join(BLOG_DIR, name), "utf8");
    const fm = frontmatter(raw);

    if (fm.category !== "journal") continue;

    const ids = Array.isArray(fm.source_ids)
      ? fm.source_ids
      : [];

    ids.map(String).forEach((id) => used.add(id));
  }

  return used;
}

function compactSnapshot(
  posts: ArchivePost[],
  used: Set<string>,
): string {
  return posts
    .filter((p) => !used.has(p.source_id))
    .map((p) =>
      [
        `SOURCE_ID: ${p.source_id}`,
        `X_ID: ${p.x_id}`,
        `DATE: ${p.created_at}`,
        `TITLE: ${p.title}`,
        `HASHTAGS: ${p.hashtags.join(" ")}`,
        `TEXT:\n${p.body}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

const task1Schema = {
  type: "OBJECT",
  properties: {
    status: {
      type: "STRING",
      enum: ["OK", "NO_JOURNAL"],
    },
    candidate: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        vector: { type: "STRING" },
        hero: { type: "STRING" },
        entry_id: { type: "STRING" },
        exit_id: { type: "STRING" },
        source_ids: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
        emergent_whole: { type: "STRING" },
        evidence: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
        scores: {
          type: "OBJECT",
          properties: {
            emergent_whole: { type: "NUMBER" },
            arc: { type: "NUMBER" },
            necessity: { type: "NUMBER" },
            minimality: { type: "NUMBER" },
            preservation: { type: "NUMBER" },
            ending: { type: "NUMBER" },
          },
          required: [
            "emergent_whole",
            "arc",
            "necessity",
            "minimality",
            "preservation",
            "ending",
          ],
        },
      },
      required: [
        "id",
        "vector",
        "hero",
        "entry_id",
        "exit_id",
        "source_ids",
        "emergent_whole",
        "evidence",
        "scores",
      ],
    },
  },
  required: ["status", "candidate"],
};

const task2Schema = {
  type: "OBJECT",
  properties: {
    status: {
      type: "STRING",
      enum: ["OK", "RETURN"],
    },
    candidate_id: { type: "STRING" },
    title: { type: "STRING" },
    description: { type: "STRING" },
    source_ids: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    markdown: { type: "STRING" },
    composition: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: {
            type: "STRING",
            enum: ["source", "bridge"],
          },
          source_id: { type: "STRING" },
          text: { type: "STRING" },
          image_side: {
            type: "STRING",
            enum: ["left", "right"],
          },
          image_size: {
            type: "STRING",
            enum: ["small", "medium", "large"],
          },
          text_offset: {
            type: "STRING",
            enum: ["up", "center", "down"],
          },
        },
        required: ["type", "text"],
      },
    },
    reason: { type: "STRING" },
    facets: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
  },
  required: [
    "status",
    "candidate_id",
    "title",
    "description",
    "source_ids",
    "markdown",
    "composition",
    "reason",
    "facets",
  ],
};

const titleCutSchema = {
  type: "OBJECT",
  properties: {
    cut_index: {
      type: "NUMBER",
      enum: [10, 11, 12, 13, 14],
    },
  },
  required: ["cut_index"],
};

const task3Schema = {
  type: "OBJECT",
  properties: {
    verdict: {
      type: "STRING",
      enum: ["STRONG", "REVISION", "NO_JOURNAL"],
    },
    reason: { type: "STRING" },
    evidence: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    revision: { type: "STRING" },
  },
  required: [
    "verdict",
    "reason",
    "evidence",
    "revision",
  ],
};

async function prompt(path: string): Promise<string> {
  return readFile(
    join(ROOT, "scripts/journal/prompts", path),
    "utf8",
  );
}

async function run() {
  const archive = await loadArchive();
  const used = await loadUsedSources();

  if (!archive.length) {
    console.log("NO_JOURNAL: archive is empty.");
    return;
  }

  // Journal discovery uses the current Explore sequence, not the public A–Z archive order.
  // The sequence is divided into up to 1000 contiguous zones and one representative
  // is selected from each zone. This gives DISCOVER broad coverage of the same
  // semantic space that users see in Explore.
  const TARGET_SAMPLE_SIZE = 1000;
  const RUN_BUDGET_MS = 105 * 60 * 1000;
  const startedAt = Date.now();

  function ensureBudget(stage: string) {
    if (Date.now() - startedAt >= RUN_BUDGET_MS) {
      throw new Error(`JOURNAL_BUDGET_EXCEEDED during ${stage}`);
    }
  }

  function stratifiedSample(
    posts: ArchivePost[],
    target: number,
  ): ArchivePost[] {
    const exploreInput = posts.map((post) => ({
      id: post.source_id,
      body: post.body,
      data: { tags: post.hashtags },
      post,
    }));

    const explored = sortExploreItems(exploreInput).map(
      (item) => item.post,
    );

    const sampleSize = Math.min(target, explored.length);
    const sampled: ArchivePost[] = [];

    for (let i = 0; i < sampleSize; i += 1) {
      const start = Math.floor(
        (i * explored.length) / sampleSize,
      );
      const end = Math.floor(
        ((i + 1) * explored.length) / sampleSize,
      );

      const zone = explored.slice(
        start,
        Math.max(start + 1, end),
      );

      sampled.push(
        zone[Math.floor(Math.random() * zone.length)],
      );
    }

    return sampled;
  }

  const eligibleArchive = archive.filter(
    (post) => !used.has(post.source_id),
  );

  const sampled = stratifiedSample(
    eligibleArchive,
    TARGET_SAMPLE_SIZE,
  );

  const snapshot = compactSnapshot(sampled, used);

  if (!snapshot.trim()) {
    console.log(
      "NO_JOURNAL: sampled archive snapshot is empty.",
    );
    return;
  }

  const snapshotIds = new Set(
    sampled.map((post) => post.source_id),
  );

  const sourceMap = new Map(
    archive.map((p) => [p.source_id, p]),
  );

  const sourcesFor = (ids: string[]) => {
    const unique = [...new Set(ids)];

    return unique
      .map((id) => sourceMap.get(id))
      .filter((p): p is ArchivePost => Boolean(p))
      .map(
        (p) =>
          `SOURCE_ID: ${p.source_id}\nTITLE: ${p.title}\nIMAGE: ${p.image}\nTEXT:\n${p.body}`,
      )
      .join("\n\n---\n\n");
  };

  // Working state for this run only. It is deliberately not persisted.
  const rejectedThisRun = new Set<string>();
  const rejectionReasons: RejectionReasons = new Map();
  const repeatedRejectedIdReturns = new Map<string, number>();
  const MAX_REPEATED_REJECTED_ID_RETURNS = 2;
  const revisionAttempts = new Map<string, number>();
  const MAX_REVISION_ATTEMPTS = 2;

  function reject(id: string, stage: RejectionStage, reason: string) {
    rejectedThisRun.add(id);
    recordRejection(rejectionReasons, id, stage, reason);
    console.log(
      `REJECT: candidate ${id}: ${reason}`,
    );
  }

  function printRejectionSummary() {
    if (!rejectionReasons.size) return;

    console.log("REJECTION SUMMARY:");

    for (const line of formatRejectionSummary(rejectionReasons)) {
      console.log(line);
    }
  }

  discoveryLoop: while (true) {
    ensureBudget("DISCOVER");

    const discoveryInstruction = rejectedThisRun.size
      ? `\n\nPREVIOUS CANDIDATES ALREADY REJECTED IN THIS RUN: ${[...rejectedThisRun].join(", ")}\nDo not return any of them. Find a genuinely different candidate from the supplied snapshot.`
      : "";

    const task1 = await generateJson(
      `${await prompt("task-1.md")}${discoveryInstruction}\n\nARCHIVE SNAPSHOT (EXPLORE-ORDERED STRATIFIED SAMPLE OF CURRENT ARCHIVE):\n${snapshot}`,
      task1Schema,
    );

    ensureBudget("DISCOVER response");

    if (
      task1.status !== "OK" ||
      !task1.candidate ||
      typeof task1.candidate.id !== "string"
    ) {
      console.log(
        "NO_JOURNAL: discovery found no viable candidate.",
      );
      printRejectionSummary();
      return;
    }

    const selected = task1.candidate;
    const selectedId = String(selected.id);

    if (rejectedThisRun.has(selectedId)) {
      const repeatCount =
        (repeatedRejectedIdReturns.get(selectedId) ?? 0) + 1;
      repeatedRejectedIdReturns.set(selectedId, repeatCount);

      console.log(
        `RETURN: DISCOVER repeated rejected candidate ${selectedId}; repeat ${repeatCount}/${MAX_REPEATED_REJECTED_ID_RETURNS}.`,
      );

      if (repeatCount >= MAX_REPEATED_REJECTED_ID_RETURNS) {
        console.warn(
          `NO_JOURNAL: discovery repeatedly returned rejected candidate ${selectedId}; stopping to prevent an unbounded loop.`,
        );
        break discoveryLoop;
      }

      continue;
    }

    const candidateSourceIds =
      Array.isArray(selected.source_ids) &&
      selected.source_ids.every(
        (id: unknown) => typeof id === "string",
      )
        ? selected.source_ids
        : [];
    const uniqueCandidateSourceIds = new Set(candidateSourceIds);
    const entryId =
      typeof selected.entry_id === "string"
        ? selected.entry_id
        : "";
    const exitId =
      typeof selected.exit_id === "string"
        ? selected.exit_id
        : "";

    const candidateSourcesValid =
      candidateSourceIds.length >= 4 &&
      candidateSourceIds.length <= 6 &&
      uniqueCandidateSourceIds.size === candidateSourceIds.length &&
      candidateSourceIds.every(
        (id) => id.length > 0 && snapshotIds.has(id),
      ) &&
      uniqueCandidateSourceIds.has(entryId) &&
      uniqueCandidateSourceIds.has(exitId);

    if (!candidateSourcesValid) {
      reject(
        selectedId,
        "DISCOVER",
        "DISCOVER candidate failed source validation",
      );
      continue;
    }

    let currentMontage: any = null;
    let lastRevisionInstruction = "";
    const seenMontages = new Set<string>();

    while (true) {
      ensureBudget(
        currentMontage
          ? "REVISION/SELECT-MONTAGE"
          : "SELECT-MONTAGE",
      );

      const task2 = await generateJson(
        currentMontage
          ? `${await prompt("task-2.md")}\n\nREVISION MODE: Preserve the proven candidate vector. You may add, remove, replace, or reorder source posts from the supplied snapshot when that is the smallest justified change. Do not leave the supplied snapshot.\n\nREVISION REQUIRED:\n${lastRevisionInstruction}\n\nSELECTED CANDIDATE:\n${JSON.stringify(selected, null, 2)}\n\nCURRENT MONTAGE:\n${JSON.stringify(currentMontage, null, 2)}\n\nAVAILABLE SOURCE TEXTS FROM THIS DISCOVERY SNAPSHOT:\n${snapshot}`
          : `${await prompt("task-2.md")}\n\nSELECTED CANDIDATE:\n${JSON.stringify(selected, null, 2)}\n\nAVAILABLE SOURCE TEXTS FROM THIS DISCOVERY SNAPSHOT:\n${snapshot}`,
        task2Schema,
      );

      ensureBudget("SELECT-MONTAGE response");

      const montageCandidateId =
        typeof task2?.candidate_id === "string"
          ? task2.candidate_id
          : "";

      if (montageCandidateId !== selectedId) {
        reject(
          selectedId,
          "SELECT-MONTAGE",
          `SELECT-MONTAGE candidate_id mismatch (expected ${selectedId}, received ${montageCandidateId || "<missing>"})`,
        );
        break;
      }

      const validation = validateMontage(
        task2,
        selectedId,
        snapshotIds,
        new Map(archive.map((post) => [post.source_id, post.image])),
      );

      if (!validation.ok) {
        reject(selectedId, "MONTAGE", validation.reason);
        break;
      }

      const montageSourceIds = validation.sourceIds;
      const uniqueMontageSourceIds = montageSourceIds;
      const composition = validation.composition;

      const montageSignature = JSON.stringify({
        source_ids: uniqueMontageSourceIds.slice().sort(),
        markdown: String(task2.markdown ?? "").trim(),
        composition,
      });

      if (seenMontages.has(montageSignature)) {
        reject(
          selectedId,
          "MONTAGE",
          "identical montage repeated",
        );
        break;
      }

      seenMontages.add(montageSignature);

      currentMontage = {
        ...task2,
        source_ids: uniqueMontageSourceIds,
        composition,
      };

      const task3 = await generateJson(
        `${await prompt("task-3.md")}\n\nTASK 1 CANDIDATE:\n${JSON.stringify(selected, null, 2)}\n\nCURRENT JOURNAL MONTAGE:\n${JSON.stringify(currentMontage, null, 2)}\n\nSOURCE TEXTS USED BY CURRENT MONTAGE:\n${sourcesFor(montageSourceIds)}`,
        task3Schema,
      );

      ensureBudget("TEST response");

      if (task3.verdict === "STRONG") {
        const slugBase = String(
          currentMontage.title || "journal",
        )
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) || "journal";

        const now = new Date();

        const date =
          String(now.getUTCDate()).padStart(2, "0") +
          "-" +
          String(now.getUTCMonth() + 1).padStart(2, "0") +
          "-" +
          now.getUTCFullYear();

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

          const boundaries = new Set([
            ".",
            ",",
            ";",
            ":",
            "—",
            "–",
          ]);

          const headingCandidates: {
            text: string;
            count: number;
            distance: number;
          }[] = [];

          let position = 0;

          for (let i = 0; i < words.length; i += 1) {
            position +=
              words[i].length +
              (i > 0 ? 1 : 0);

            if (
              i + 1 < targetMin ||
              i + 1 > targetMax
            ) {
              continue;
            }

            const nextChar = plain[position] ?? "";
            const endChar = words[i].slice(-1);

            if (
              boundaries.has(endChar) ||
              boundaries.has(nextChar)
            ) {
              headingCandidates.push({
                text: words
                  .slice(0, i + 1)
                  .join(" "),
                count: i + 1,
                distance: Math.abs(
                  i + 1 - 12,
                ),
              });
            }
          }

          if (headingCandidates.length > 0) {
            headingCandidates.sort(
              (a, b) =>
                a.distance - b.distance ||
                a.count - b.count,
            );

            return headingCandidates[0].text;
          }

          return (
            words
              .slice(0, targetMax)
              .join(" ") + "…"
          );
        }

        function plainJournalText(text: string): string {
          return text
            .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
            .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
            .replace(/[#>*_~\`]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }

        async function chooseTitleCut(text: string): Promise<number | null> {
          const plain = plainJournalText(text);
          const words = plain.split(" ").filter(Boolean);

          if (words.length <= 14) return null;

          const context = words.slice(0, 24).join(" ");

          try {
            const result = await generateJson(
              `${await prompt("title-cut.md")}${context}`,
              titleCutSchema,
            );

            const cutIndex = Number(result?.cut_index);

            if (
              !Number.isInteger(cutIndex) ||
              cutIndex < 10 ||
              cutIndex > 14 ||
              cutIndex > words.length
            ) {
              return null;
            }

            return cutIndex;
          } catch (error) {
            console.warn(
              "TITLE CUT: semantic selection failed; using legacy journalHeading().",
              error,
            );
            return null;
          }
        }

        const plainMarkdown = plainJournalText(
          String(currentMontage.markdown),
        );
        const headingWords = plainMarkdown
          .split(" ")
          .filter(Boolean);

        const titleCut = await chooseTitleCut(
          String(currentMontage.markdown),
        );

        const journalTitle =
          titleCut !== null
            ? headingWords.slice(0, titleCut).join(" ") + "…"
            : journalHeading(String(currentMontage.markdown));

        const markdown = `---
draft: false
date: "${date}"
title: "${journalTitle.replace(/"/g, "\\\"")}"
description: "${String(currentMontage.description).replace(/"/g, "\\\"")}"
category: "journal"
tags: ["archive"]
author: "PEKHTOGRAPHY"
source_ids: [${uniqueMontageSourceIds
          .map((id: string) => JSON.stringify(id))
          .join(", ")}]
facets: [${(
          Array.isArray(currentMontage.facets)
            ? currentMontage.facets
            : []
        )
          .map((facet: string) => JSON.stringify(facet))
          .join(", ")}]
composition: ${JSON.stringify(
          currentMontage.composition,
        )}
---

${String(currentMontage.markdown).trim()}
`;

        const outputPath = join(BLOG_DIR, `${slug}.md`);

        if (existsSync(outputPath)) {
          throw new Error(
            `JOURNAL_OUTPUT_CONFLICT: refusing to overwrite existing publication ${slug}.md.`,
          );
        }

        try {
          // "wx" makes the no-overwrite policy atomic if another writer races this check.
          await writeFile(outputPath, markdown, {
            encoding: "utf8",
            flag: "wx",
          });
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            throw new Error(
              `JOURNAL_OUTPUT_CONFLICT: refusing to overwrite existing publication ${slug}.md.`,
            );
          }
          throw error;
        }

        console.log(
          `STRONG JOURNAL: ${slug}.md`,
        );

        return;
      }

      if (task3.verdict === "REVISION") {
        const attempts =
          (revisionAttempts.get(selectedId) ?? 0) + 1;

        revisionAttempts.set(
          selectedId,
          attempts,
        );

        if (
          attempts > MAX_REVISION_ATTEMPTS
        ) {
          reject(
            selectedId,
            "REVISION",
            "revision limit exceeded",
          );

          break;
        }

        const revision = String(
          task3.revision ?? "",
        ).trim();

        if (
          !revision ||
          revision === lastRevisionInstruction
        ) {
          reject(
            selectedId,
            "REVISION",
            "repeated revision instruction",
          );

          break;
        }

        lastRevisionInstruction = revision;

        console.log(
          `REVISION: candidate ${selectedId}; attempt ${attempts}/${MAX_REVISION_ATTEMPTS}.`,
        );

        continue;
      }

      reject(
        selectedId,
        "TEST",
        `TEST rejected: ${task3.reason}`,
      );

      break;
    }
  }

  printRejectionSummary();

  console.log(
    "NO_JOURNAL: all discovery/selection/validation paths exhausted.",
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
