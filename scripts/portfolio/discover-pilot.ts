import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { generatePortfolioJson, PortfolioProviderError } from "./provider.ts";
import { readPortfolioSnapshot } from "./snapshot.ts";
import { validateDiscoveryRecords } from "../../validation/portfolio-validation-0.2.1/src/validators.ts";

const snapshotPath = process.env.PORTFOLIO_SNAPSHOT_PATH ?? "snapshot/portfolio-snapshot.json";
const outputPath = process.env.PORTFOLIO_DISCOVER_RESULT_PATH ?? "portfolio-discover-pilot-result.json";
const PILOT_SIZE = 20;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["records"],
  properties: {
    records: {
      type: "array",
      minItems: PILOT_SIZE,
      maxItems: PILOT_SIZE,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source_id", "result", "observations"],
        properties: {
          source_id: { type: "string", minLength: 1, maxLength: 128 },
          result: { enum: ["SIGNALS_FOUND", "NO_SIGNAL"] },
          observations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["prism", "signal", "interpretation", "evidence"],
              properties: {
                prism: { type: "string", minLength: 1 },
                signal: { type: "string", minLength: 1 },
                interpretation: { type: "string", minLength: 1 },
                evidence: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["source", "quote"],
                    properties: {
                      source: { enum: ["BODY", "ORIGINAL_MARKDOWN"] },
                      quote: { type: "string", minLength: 1 }
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
  note: "Twenty-publication live DISCOVER pilot only. This is not full 1000-publication Discovery coverage and does not complete the production DISCOVER stage."
};

function modelDiagnostics(error: unknown) {
  if (error instanceof PortfolioProviderError) return error.model_used;
  if (typeof error === "object" && error !== null && "model_used" in error && Array.isArray(error.model_used)) {
    return error.model_used;
  }
  return [];
}

try {
  const loaded = await readPortfolioSnapshot(snapshotPath);
  const posts = loaded.snapshot.posts;
  if (posts.length !== 1000) throw new Error(`Expected the approved 1000-post Snapshot; found ${posts.length}.`);

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

  const records = payload.records as Array<{ source_id: string }>;
  const validationIssues = validateDiscoveryRecords(records as never[]);
  const returnedIds = records.map((record) => record?.source_id);
  const idCounts = new Map<string, number>();
  for (const id of returnedIds) if (typeof id === "string") idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  const missing = sourceIds.filter((id) => idCounts.get(id) !== 1);
  const unexpected = returnedIds.filter((id) => typeof id !== "string" || !sourceIds.includes(id));
  if (validationIssues.length > 0 || missing.length > 0 || unexpected.length > 0 || records.length !== PILOT_SIZE) {
    result.validation = { status: "FAIL", issues: validationIssues, missing_or_duplicate_source_ids: missing, unexpected_source_ids: unexpected };
    result.records = records;
    throw new Error("DISCOVER response failed record structure or exact 20-source coverage validation.");
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
