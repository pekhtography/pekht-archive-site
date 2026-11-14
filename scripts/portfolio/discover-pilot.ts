import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { generatePortfolioJson, PortfolioProviderError } from "./provider.ts";
import { computePortfolioSnapshotContentHash, PORTFOLIO_SNAPSHOT_PURPOSE } from "./snapshot.ts";
import { validateDiscoveryRecords } from "../../validation/portfolio-validation-0.2.1/src/validators.ts";

const snapshotPath = process.env.PORTFOLIO_SNAPSHOT_PATH ?? "snapshot/portfolio-snapshot.json";
const outputPath = process.env.PORTFOLIO_DISCOVER_RESULT_PATH ?? "portfolio-discover-pilot-result.json";
const PILOT_SIZE = 100;

const responseSchema = {
  // Gemini responseSchema supports a restricted schema subset; strict extra-key rejection
  // is enforced locally by validateDiscoveryRecords after generation, not sent to Gemini.
  type: "object",
  required: ["records"],
  properties: {
    records: {
      type: "array",
      items: {
        type: "object",
        required: ["source_id", "result", "observations"],
        properties: {
          source_id: { type: "string" },
          result: { enum: ["SIGNALS_FOUND", "NO_SIGNAL"] },
          observations: {
            type: "array",
            items: {
              type: "object",
              required: ["prism", "signal", "interpretation", "evidence"],
              properties: {
                prism: { type: "string" },
                signal: { type: "string" },
                interpretation: { type: "string" },
                evidence: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["source", "quote"],
                    properties: {
                      source: { enum: ["BODY", "ORIGINAL_MARKDOWN"] },
                      quote: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

const result: Record<string, unknown> = {
  status: "INCOMPLETE",
  stage: "DISCOVER",
  pilot: true,
  requested_count: PILOT_SIZE,
  model_used: [],
  records: [],
  note: "One-hundred-publication live DISCOVER pilot only. This is not full 1000-publication Discovery coverage and does not complete the production DISCOVER stage."
};

function modelDiagnostics(error: unknown) {
  if (error instanceof PortfolioProviderError) return error.model_used;
  if (typeof error === "object" && error !== null && "model_used" in error && Array.isArray(error.model_used)) {
    return error.model_used;
  }
  return [];
}

function normalizeDiscoveryEvidenceSources(records: unknown): unknown {
  if (!Array.isArray(records)) return records;

  return records.map((record) => {
    if (!record || typeof record !== "object") return record;
    const recordObject = record as Record<string, unknown>;
    if (!Array.isArray(recordObject.observations)) return record;

    return {
      ...recordObject,
      observations: recordObject.observations.map((observation) => {
        if (!observation || typeof observation !== "object") return observation;
        const observationObject = observation as Record<string, unknown>;
        if (!Array.isArray(observationObject.evidence)) return observation;

        return {
          ...observationObject,
          evidence: observationObject.evidence.map((evidence) => {
            if (!evidence || typeof evidence !== "object") return evidence;
            const evidenceObject = evidence as Record<string, unknown>;
            if (evidenceObject.source === "body") return { ...evidenceObject, source: "BODY" };
            if (evidenceObject.source === "original_markdown") {
              return { ...evidenceObject, source: "ORIGINAL_MARKDOWN" };
            }
            return evidence;
          })
        };
      })
    };
  });
}


try {
  // Pilot-specific integrity gate: preserve the immutable Snapshot identity and full
  // content digest, while not requiring created_at (unused by DISCOVER). The general
  // production Snapshot validator remains unchanged and mandatory for production use.
  const rawSnapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<string, unknown>;
  if (rawSnapshot.schema_version !== 1 || rawSnapshot.purpose !== PORTFOLIO_SNAPSHOT_PURPOSE) {
    throw new Error("Snapshot schema_version or purpose does not match the approved Portfolio Snapshot contract.");
  }
  if (typeof rawSnapshot.repository_commit !== "string" || !/^[a-f0-9]{40}$/i.test(rawSnapshot.repository_commit)) {
    throw new Error("Snapshot repository_commit is missing or invalid.");
  }
  if (typeof rawSnapshot.generated_at !== "string" || Number.isNaN(Date.parse(rawSnapshot.generated_at))) {
    throw new Error("Snapshot generated_at is missing or invalid.");
  }
  if (!Array.isArray(rawSnapshot.posts) || rawSnapshot.posts.length !== 1000) {
    throw new Error(`Expected the approved 1000-post Snapshot; found ${Array.isArray(rawSnapshot.posts) ? rawSnapshot.posts.length : "non-array"}.`);
  }
  if (!Array.isArray(rawSnapshot.sampled_source_ids) || rawSnapshot.sampled_source_ids.length !== 1000) {
    throw new Error("Snapshot sampled_source_ids must contain exactly 1000 IDs.");
  }
  if (rawSnapshot.sampled_count !== 1000) throw new Error("Snapshot sampled_count must equal 1000.");
  if (typeof rawSnapshot.content_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(rawSnapshot.content_sha256)) {
    throw new Error("Snapshot content_sha256 is missing or invalid.");
  }
  const posts = rawSnapshot.posts as Array<Record<string, unknown>>;
  const snapshotIds = rawSnapshot.sampled_source_ids as string[];
  const postIds = posts.map((post) => post.source_id);
  if (postIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(postIds).size !== 1000 ||
      postIds.some((id, index) => id !== snapshotIds[index])) {
    throw new Error("Snapshot post source_id sequence is invalid or differs from sampled_source_ids.");
  }
  const excludedIds = new Set<string>();
  for (const field of ["active_gallery_exclusions", "cooldown_exclusions"]) {
    const exclusions = rawSnapshot[field];
    if (!Array.isArray(exclusions)) throw new Error(`Snapshot ${field} must be an array.`);
    for (const item of exclusions) {
      if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).source_id !== "string") {
        throw new Error(`Snapshot ${field} contains an invalid exclusion.`);
      }
      excludedIds.add((item as Record<string, unknown>).source_id as string);
    }
  }
  if (snapshotIds.some((id) => excludedIds.has(id))) throw new Error("Snapshot includes a source_id marked as excluded.");
  for (const [index, post] of posts.entries()) {
    for (const field of ["source_id", "x_id", "title", "body", "image", "original_markdown"]) {
      if (typeof post[field] !== "string" || !(post[field] as string).trim()) {
        throw new Error(`Snapshot posts[${index}].${field} is missing or empty.`);
      }
    }
    if (!Array.isArray(post.hashtags) || !post.hashtags.every((tag) => typeof tag === "string")) {
      throw new Error(`Snapshot posts[${index}].hashtags is invalid.`);
    }
  }
  const actualSnapshotHash = computePortfolioSnapshotContentHash({
    sampled_source_ids: snapshotIds,
    posts: posts as never[]
  });
  if (actualSnapshotHash !== rawSnapshot.content_sha256) {
    throw new Error(`Snapshot content hash mismatch: expected ${String(rawSnapshot.content_sha256)}, computed ${actualSnapshotHash}.`);
  }
  const loaded = {
    snapshot: rawSnapshot as unknown as { posts: typeof posts; content_sha256: string },
    input_snapshot: {
      schema_version: "1",
      repository_commit: rawSnapshot.repository_commit,
      generated_at: rawSnapshot.generated_at,
      sampled_count: 1000 as const,
      content_sha256: rawSnapshot.content_sha256
    }
  };

  // Deterministic, evenly spaced selection across the immutable Snapshot order.
  const indices = Array.from({ length: PILOT_SIZE }, (_, index) =>
    Math.round(index * (posts.length - 1) / (PILOT_SIZE - 1)));
  const selected = indices.map((index) => posts[index]);
  const sourceIds = selected.map((post) => post.source_id);
  if (new Set(sourceIds).size !== PILOT_SIZE) throw new Error("Pilot selection contains duplicate source IDs.");

  const inputPosts = selected.map((post) => ({
    source_id: post.source_id,
    title: post.title,
    body: post.body,
    original_markdown: post.original_markdown
  }));
  const prompt = [
    "You are the DISCOVER stage of PEKHTOGRAPHY Portfolio.",
    "Analyze each publication independently. Do not compose galleries, compare publications, or propose six-post candidates.",
    "The complete body text is the primary source of meaning. Hashtags are part of the supplied text and may carry meaning, but are not privileged and must never be the sole evidence for an observation.",
    "Use only explicit textual evidence from BODY or ORIGINAL_MARKDOWN. Do not infer meaning from images, filenames, metadata, popularity, or assumptions.",
    "Look for grounded observations through curatorial prisms including Motif, Field, Material, Rhetorical Transformation, Reframing, Metaphor, Contrast, Threshold, Time, Scale, Sensorial Shift, Vector, Resonance, Agency, Micro/Macro-dramaturgy, Observation, Composition, and Lexical echoes.",
    "An observation must identify a specific textual signal and explain its interpretation. Every observation must include at least one exact, verbatim, contiguous quotation from the named source field. Never invent or normalize quotations.",
    "Return exactly one Discovery record for every supplied source_id. Use SIGNALS_FOUND with one or more observations when grounded signals exist; otherwise use NO_SIGNAL with an empty observations array. Do not treat a technical uncertainty as NO_SIGNAL.",
    "Return only JSON matching the supplied response schema.",
    "PUBLICATIONS:",
    JSON.stringify(inputPosts)
  ].join("\n\n");

  result.input_snapshot = loaded.input_snapshot;
  result.snapshot_content_sha256 = loaded.snapshot.content_sha256;
  result.selected_indices = indices;
  result.selected_source_ids = sourceIds;
  result.input_sha256 = createHash("sha256").update(JSON.stringify(inputPosts), "utf8").digest("hex");
  result.prompt_sha256 = createHash("sha256").update(prompt, "utf8").digest("hex");

  const generated = await generatePortfolioJson(prompt, responseSchema, {
    stage: "DISCOVER",
    candidateId: null,
    timeoutMs: 180_000,
    maxAttemptsPerModel: 3,
    maxRetryDelayMs: 120_000
  });
  result.model_used = generated.model_used;

  const payload = generated.data as unknown as { records?: unknown };
  if (!payload || !Array.isArray(payload.records)) throw new Error("Gemini DISCOVER response is missing the records array.");

  const normalizedRecords = normalizeDiscoveryEvidenceSources(payload.records);
  const records = normalizedRecords as Array<{ source_id: string }>;
  const validationIssues = validateDiscoveryRecords(records as never[]);
  const returnedIds = records.map((record) => record?.source_id);
  const idCounts = new Map<string, number>();
  for (const id of returnedIds) if (typeof id === "string") idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  const missing = sourceIds.filter((id) => idCounts.get(id) !== 1);
  const unexpected = returnedIds.filter((id) => typeof id !== "string" || !sourceIds.includes(id));
  if (validationIssues.length > 0 || missing.length > 0 || unexpected.length > 0 || records.length !== PILOT_SIZE) {
    result.validation = { status: "FAIL", issues: validationIssues, missing_or_duplicate_source_ids: missing, unexpected_source_ids: unexpected };
    result.records = records;
    throw new Error("DISCOVER response failed record structure or exact 100-source coverage validation.");
  }

  const byId = new Map(records.map((record) => [record.source_id, record]));
  const orderedRecords = sourceIds.map((id) => byId.get(id)!);
  result.records = orderedRecords;
  result.validation = { status: "PASS", issues: [] };
  result.status = "SUCCESS";
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  if (!Array.isArray(result.model_used) || result.model_used.length === 0) {
    result.model_used = modelDiagnostics(error);
  }
}

result.completed_at = new Date().toISOString();
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
if (result.status !== "SUCCESS") process.exitCode = 1;
