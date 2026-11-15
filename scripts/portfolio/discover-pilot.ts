import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { generatePortfolioJson, PortfolioProviderError } from "./provider.ts";
import { computePortfolioSnapshotContentHash, PORTFOLIO_SNAPSHOT_PURPOSE } from "./snapshot.ts";
import { validateDiscoveryRecords } from "../../validation/portfolio-validation-0.2.1/src/validators.ts";
import { buildDiscoveryResponseSchema, inspectDiscoveryCoverage, mapDiscoverySourceIndexes, selectBatchesToProcess, splitIntoBatches, validateDiscoveryEvidenceQuotes } from "./discover-batches.ts";

const snapshotPath = process.env.PORTFOLIO_SNAPSHOT_PATH ?? "snapshot/portfolio-snapshot.json";
const outputPath = process.env.PORTFOLIO_DISCOVER_RESULT_PATH ?? "portfolio-discover-pilot-result.json";
const PILOT_SIZE = 1000;
const BATCH_SIZE = 100;
const INTER_BATCH_DELAY_MS = 15_000;

const result: Record<string, unknown> = {
  status: "INCOMPLETE",
  stage: "DISCOVER",
  pilot: true,
  requested_count: PILOT_SIZE,
  model_used: [],
  model_diagnostics: [],
  response_diagnostics: [],
  batch_results: [],
  records: [],
  note: "Full 1000-publication live DISCOVER run on the approved immutable Snapshot. This integration run does not execute downstream Portfolio stages."
};

function modelDiagnostics(error: unknown) {
  if (error instanceof PortfolioProviderError) return error.model_used;
  if (typeof error === "object" && error !== null && "model_used" in error && Array.isArray(error.model_used)) {
    return error.model_used;
  }
  return [];
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

  const batches = splitIntoBatches(selected, BATCH_SIZE);
  if (batches.length !== 10 || batches.some((batch) => batch.length !== BATCH_SIZE)) {
    throw new Error("Expected exactly 10 DISCOVER batches of 100 publications.");
  }

  result.input_snapshot = loaded.input_snapshot;
  result.snapshot_content_sha256 = loaded.snapshot.content_sha256;
  result.selected_indices = indices;
  result.selected_source_ids = sourceIds;

  const resumePath = process.env.PORTFOLIO_DISCOVER_RESUME_PATH;
  let priorResult: Record<string, unknown> | null = null;
  let priorBatchResults: Array<Record<string, unknown>> = [];
  if (resumePath) {
    priorResult = JSON.parse(await readFile(resumePath, "utf8")) as Record<string, unknown>;
    if (priorResult.stage !== "DISCOVER" || priorResult.pilot !== true || priorResult.requested_count !== PILOT_SIZE || !Array.isArray(priorResult.batch_results) || priorResult.batch_results.length !== 10) {
      throw new Error("Resume artifact does not match the 1000-publication DISCOVER result contract.");
    }
    priorBatchResults = priorResult.batch_results as Array<Record<string, unknown>>;
    result.note = "Resumed DISCOVER from a prior immutable Snapshot run. Previously successful batches are reused only after exact input-hash, structure, BODY-evidence, and source-ID coverage checks; all other batches are regenerated.";
    const priorIndexes = priorBatchResults.map((item) => item.batch_index);
    if (new Set(priorIndexes).size !== 10 || Array.from({ length: 10 }, (_, index) => index + 1).some((index) => !priorIndexes.includes(index))) {
      throw new Error("Resume artifact must contain exactly one result for each of the 10 original batches.");
    }
    result.resumed_from_run_id = process.env.PORTFOLIO_DISCOVER_RESUME_RUN_ID ?? "unspecified";
  }

  const allSuccessfulRecords: Array<{ source_id: string; [key: string]: unknown }> = [];
  const batchResults: Array<Record<string, unknown> | undefined> = new Array(batches.length);
  for (const [batchIndex, batch] of batches.entries()) {
    const batchNumber = batchIndex + 1;
    const prior = priorBatchResults.find((item) => item.batch_index === batchNumber && item.status === "SUCCESS");
    if (!prior || !Array.isArray(prior.records)) continue;
    const expectedIds = batch.map((post) => String(post.source_id));
    const currentInput = batch.map((post) => ({ source_id: post.source_id, title: post.title, body: post.body }));
    const currentInputHash = createHash("sha256").update(JSON.stringify(currentInput), "utf8").digest("hex");
    const priorRecords = prior.records as Array<{ source_id: string; [key: string]: unknown }>;
    const coverage = inspectDiscoveryCoverage(expectedIds, priorRecords);
    const bodyOnly = priorRecords.every((record) =>
      record !== null && typeof record === "object" && Array.isArray(record.observations) && (record.observations as Array<Record<string, unknown>>).every((observation) =>
        Array.isArray(observation.evidence) && (observation.evidence as Array<Record<string, unknown>>).every((evidence) => evidence.source === "BODY")
      )
    );
    const structurallyValid = validateDiscoveryRecords(priorRecords as never[]).length === 0;
    const quoteValid = validateDiscoveryEvidenceQuotes(
      priorRecords as Array<{ source_id: string; observations?: unknown }>,
      batch.map((post) => ({ source_id: String(post.source_id), body: String(post.body) }))
    ).length === 0;
    const reusable = prior.input_sha256 === currentInputHash &&
      priorRecords.length === BATCH_SIZE &&
      coverage.missingSourceIds.length === 0 &&
      coverage.unexpectedSourceIds.length === 0 &&
      coverage.duplicateSourceIds.length === 0 &&
      bodyOnly && structurallyValid && quoteValid;
    if (reusable) {
      batchResults[batchIndex] = prior;
      allSuccessfulRecords.push(...coverage.orderedRecords);
    }
  }

  const reusableBatchIndexes = batchResults.flatMap((item, index) => item ? [index + 1] : []);
  const batchesToProcess = selectBatchesToProcess(batches, reusableBatchIndexes);
  const pendingBatchIndexes = new Set(batchesToProcess.map((batch) => batches.indexOf(batch)));
  const priorModelUsed = priorResult && Array.isArray(priorResult.model_used) ? priorResult.model_used : [];
  const priorModelDiagnostics = priorResult && Array.isArray(priorResult.model_diagnostics) ? priorResult.model_diagnostics : [];
  const priorResponseDiagnostics = priorResult && Array.isArray(priorResult.response_diagnostics) ? priorResult.response_diagnostics : [];
  const allModelUsed: unknown[] = [...priorModelUsed];
  const allModelDiagnostics: unknown[] = [...priorModelDiagnostics];
  const allResponseDiagnostics: unknown[] = [...priorResponseDiagnostics];

  for (const [batchIndex, batch] of batches.entries()) {
    if (!pendingBatchIndexes.has(batchIndex)) continue;
    const batchNumber = batchIndex + 1;
    const batchSourceIds = batch.map((post) => String(post.source_id));
    const inputPosts = batch.map((post) => ({
      source_id: post.source_id,
      title: post.title,
      body: post.body
    }));
    const promptPosts = inputPosts.map((post, source_index) => ({
      source_index,
      title: post.title,
      body: post.body
    }));
    const prompt = [
      "You are the DISCOVER stage of PEKHTOGRAPHY Portfolio.",
      "Analyze each publication independently. Do not compose galleries, compare publications, or propose six-post candidates.",
      "The complete body text is the primary source of meaning. Hashtags are part of the supplied text and may carry meaning, but are not privileged and must never be the sole evidence for an observation.",
      "Use only explicit textual evidence from BODY. Do not infer meaning from images, filenames, metadata, popularity, or assumptions.",
      "Look for grounded observations through curatorial prisms including Motif, Field, Material, Rhetorical Transformation, Reframing, Metaphor, Contrast, Threshold, Time, Scale, Sensorial Shift, Vector, Resonance, Agency, Micro/Macro-dramaturgy, Observation, Composition, and Lexical echoes.",
      "An observation must identify a specific textual signal and explain its interpretation. Every observation must include at least one exact, verbatim, contiguous quotation from the named source field. Never invent or normalize quotations.",
      "Return exactly one Discovery record for every supplied publication. Identify each publication only by its supplied zero-based source_index (0 through 99). Copy the integer index exactly; do not invent, omit, duplicate, or reorder indexes. Never return or reconstruct source_id values.",
      "Use SIGNALS_FOUND with one or more observations when grounded signals exist; otherwise use NO_SIGNAL with an empty observations array. Do not treat a technical uncertainty as NO_SIGNAL.",
      "Return only JSON matching the supplied response schema.",
      "PUBLICATIONS:",
      JSON.stringify(promptPosts)
    ].join("\n\n");

    const previousAttempt = priorBatchResults.find((item) => item.batch_index === batchNumber);
    const batchResult: Record<string, unknown> = {
      ...(previousAttempt ? { previous_attempt: {
        status: previousAttempt.status,
        returned_count: previousAttempt.returned_count,
        input_sha256: previousAttempt.input_sha256,
        prompt_sha256: previousAttempt.prompt_sha256,
        validation: previousAttempt.validation,
        error: previousAttempt.error,
        model_used: previousAttempt.model_used,
        model_diagnostics: previousAttempt.model_diagnostics
      } } : {}),
      batch_index: batchNumber,
      batch_count: batches.length,
      requested_count: batch.length,
      first_source_id: batchSourceIds[0],
      last_source_id: batchSourceIds.at(-1),
      input_sha256: createHash("sha256").update(JSON.stringify(inputPosts), "utf8").digest("hex"),
      prompt_sha256: createHash("sha256").update(prompt, "utf8").digest("hex"),
      status: "INCOMPLETE",
      returned_count: 0,
      records: []
    };

    try {
      const generated = await generatePortfolioJson(prompt, buildDiscoveryResponseSchema(), {
        stage: "DISCOVER",
        candidateId: null,
        timeoutMs: 180_000,
        maxAttemptsPerModel: 3,
        maxRetryDelayMs: 120_000
      });
      batchResult.model_used = generated.model_used;
      batchResult.model_diagnostics = generated.model_diagnostics;
      batchResult.response_diagnostics = generated.response_diagnostics;
      allModelUsed.push(...generated.model_used);
      allModelDiagnostics.push(...generated.model_diagnostics);
      allResponseDiagnostics.push({ batch_index: batchNumber, ...generated.response_diagnostics });

      const payload = generated.data as unknown as { records?: unknown };
      if (!payload || !Array.isArray(payload.records)) throw new Error("Gemini DISCOVER response is missing the records array.");

      const rawRecords = payload.records as Array<{ source_index?: unknown; [key: string]: unknown }>;
      const records = mapDiscoverySourceIndexes(rawRecords, batch);
      batchResult.returned_count = records.length;
      batchResult.records = records;

      const invalidEvidenceSources: Array<{ code: string; message: string }> = [];
      for (const record of records) {
        if (!record || typeof record !== "object" || !Array.isArray((record as Record<string, unknown>).observations)) continue;
        for (const [observationIndex, observation] of ((record as Record<string, unknown>).observations as unknown[]).entries()) {
          if (!observation || typeof observation !== "object" || !Array.isArray((observation as Record<string, unknown>).evidence)) continue;
          for (const [evidenceIndex, evidence] of ((observation as Record<string, unknown>).evidence as unknown[]).entries()) {
            if (!evidence || typeof evidence !== "object" || (evidence as Record<string, unknown>).source !== "BODY") {
              invalidEvidenceSources.push({
                code: "DISCOVERY_EVIDENCE_SOURCE_INVALID",
                message: `Evidence source must be BODY at ${String((record as Record<string, unknown>).source_id)}:${observationIndex}:${evidenceIndex}`
              });
            }
          }
        }
      }

      const quoteIssues = validateDiscoveryEvidenceQuotes(
        records as Array<{ source_id: string; observations?: unknown }>,
        batch.map((post) => ({ source_id: String(post.source_id), body: String(post.body) }))
      );
      const validationIssues = [...validateDiscoveryRecords(records as never[]), ...invalidEvidenceSources, ...quoteIssues];
      const coverage = inspectDiscoveryCoverage(batchSourceIds, records);
      const batchPass = validationIssues.length === 0 &&
        coverage.missingSourceIds.length === 0 &&
        coverage.unexpectedSourceIds.length === 0 &&
        coverage.duplicateSourceIds.length === 0 &&
        records.length === batch.length;

      batchResult.validation = {
        status: batchPass ? "PASS" : "FAIL",
        issues: validationIssues,
        missing_or_duplicate_source_ids: coverage.missingSourceIds,
        duplicate_source_ids: coverage.duplicateSourceIds,
        unexpected_source_ids: coverage.unexpectedSourceIds
      };

      if (batchPass) {
        batchResult.status = "SUCCESS";
        allSuccessfulRecords.push(...coverage.orderedRecords);
      } else {
        batchResult.error = "Batch failed record structure, BODY evidence, or exact 100-source coverage validation.";
      }
    } catch (error) {
      batchResult.error = error instanceof Error ? error.message : String(error);
      batchResult.model_used = modelDiagnostics(error);
      if (error instanceof PortfolioProviderError) batchResult.model_diagnostics = error.model_diagnostics;
      if (Array.isArray(batchResult.model_used)) allModelUsed.push(...batchResult.model_used);
      if (Array.isArray(batchResult.model_diagnostics)) allModelDiagnostics.push(...batchResult.model_diagnostics);
    }

    batchResults[batchIndex] = batchResult;
    result.batch_results = batchResults.filter((item): item is Record<string, unknown> => Boolean(item));
    result.model_used = allModelUsed;
    result.model_diagnostics = allModelDiagnostics;
    result.response_diagnostics = allResponseDiagnostics;
    result.records = allSuccessfulRecords;
    result.completed_batches = batchResults.filter((item) => item?.status === "SUCCESS").length;
    result.failed_batches = batchResults.flatMap((item) => item && item.status !== "SUCCESS" ? [item.batch_index] : []);
    await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");

    if (batchIndex < batches.length - 1 && pendingBatchIndexes.has(batchIndex + 1)) {
      await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS));
    }
  }

  const finalCoverage = inspectDiscoveryCoverage(sourceIds, allSuccessfulRecords);
  const completeBatchResults = batchResults.filter((item): item is Record<string, unknown> => Boolean(item));
  const failedBatchNumbers = completeBatchResults.filter((item) => item.status !== "SUCCESS").map((item) => item.batch_index);
  const finalPass = failedBatchNumbers.length === 0 &&
    allSuccessfulRecords.length === PILOT_SIZE &&
    finalCoverage.missingSourceIds.length === 0 &&
    finalCoverage.unexpectedSourceIds.length === 0 &&
    finalCoverage.duplicateSourceIds.length === 0;

  result.records = finalCoverage.orderedRecords;
  result.batch_results = completeBatchResults;
  result.model_used = allModelUsed;
  result.model_diagnostics = allModelDiagnostics;
  result.response_diagnostics = allResponseDiagnostics;
  result.completed_batches = completeBatchResults.filter((item) => item.status === "SUCCESS").length;
  result.failed_batches = failedBatchNumbers;
  result.validation = {
    status: finalPass ? "PASS" : "FAIL",
    issues: [],
    missing_or_duplicate_source_ids: finalCoverage.missingSourceIds,
    duplicate_source_ids: finalCoverage.duplicateSourceIds,
    unexpected_source_ids: finalCoverage.unexpectedSourceIds,
    failed_batches: failedBatchNumbers
  };
  if (finalPass) {
    result.status = "SUCCESS";
  } else {
    result.status = "INCOMPLETE";
    result.error = `DISCOVER batch processing incomplete. Successful batches: ${completeBatchResults.length - failedBatchNumbers.length}/${batches.length}; failed batches: ${failedBatchNumbers.join(", ") || "none"}; final unique coverage: ${finalCoverage.orderedRecords.length}/${PILOT_SIZE}.`;
  }
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  if (!Array.isArray(result.model_used) || result.model_used.length === 0) {
    result.model_used = modelDiagnostics(error);
  }
  if (error instanceof PortfolioProviderError) {
    result.model_diagnostics = error.model_diagnostics;
  }
}

result.completed_at = new Date().toISOString();
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
if (result.status !== "SUCCESS") process.exitCode = 1;
