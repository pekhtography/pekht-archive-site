import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readPortfolioSnapshot } from "./snapshot.ts";
import { generatePortfolioGallery, evaluateIndependentTest, type JsonSchema, type PortfolioProviderOptions } from "./provider.ts";
import { validateGeminiGallery, validatePortfolioSemantics, validateIndependentTestResponseV132 } from "./validation/index.ts";
import type { ModelCallRecord } from "./validation/types.ts";
import type { IndependentTestValidationContextV132 } from "./validation/test-response-v132-validator.ts";

const snapshotPath = process.env.PORTFOLIO_SNAPSHOT_PATH ?? "portfolio-snapshot.json";
const outputPath = process.env.PORTFOLIO_RESULT_PATH ?? "portfolio-real-gemini-smoke-result.json";
const candidateId = process.env.PORTFOLIO_CANDIDATE_ID ?? "";
const sourceIds = (process.env.PORTFOLIO_SOURCE_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
const gallerySchemaPath = fileURLToPath(new URL("./schemas/gemini-gallery.schema.json", import.meta.url));
const testSchemaPath = fileURLToPath(new URL("./schemas/independent-test-response-v1.3.2.schema.json", import.meta.url));

async function readSchema(path: string): Promise<JsonSchema> {
  return JSON.parse(await readFile(path, "utf8")) as JsonSchema;
}

function diagnostics(error: unknown): ModelCallRecord[] {
  if (typeof error === "object" && error !== null && "model_used" in error && Array.isArray(error.model_used)) {
    return error.model_used as ModelCallRecord[];
  }
  return [];
}

const result: Record<string, unknown> = {
  status: "INCOMPLETE",
  candidate_id: candidateId || null,
  source_ids: sourceIds,
  model_used: [] as ModelCallRecord[],
  stages_completed: [],
  note: "One-candidate live provider smoke test only; this is not a full corpus run or an APPROVED production gallery.",
};

try {
  if (!/^cand_[a-f0-9]{64}$/.test(candidateId)) throw new Error("PORTFOLIO_CANDIDATE_ID must be cand_ followed by 64 lowercase hexadecimal characters.");
  if (sourceIds.length !== 6 || new Set(sourceIds).size !== 6) throw new Error("PORTFOLIO_SOURCE_IDS must contain exactly six unique comma-separated source IDs.");

  const loaded = await readPortfolioSnapshot(snapshotPath);
  const postById = new Map(loaded.snapshot.posts.map((post) => [post.source_id, post]));
  const posts = sourceIds.map((id) => {
    const post = postById.get(id);
    if (!post) throw new Error(`Source ID ${id} is not present in the validated Snapshot.`);
    return post;
  });
  const promptPosts = posts.map((post) => ({
    source_id: post.source_id,
    title: post.title,
    body: post.body,
    hashtags: post.hashtags,
  }));
  const sourceTexts = Object.fromEntries(posts.map((post) => [post.source_id, post.body]));

  result.input_snapshot = loaded.input_snapshot;
  result.snapshot_content_sha256 = loaded.snapshot.content_sha256;

  const gallerySchema = await readSchema(gallerySchemaPath);
  const testSchema = await readSchema(testSchemaPath);
  const modelUsed: ModelCallRecord[] = [];
  const basePrompt = [
    "You are the curatorial composition stage of PEKHTOGRAPHY Portfolio.",
    "Create one original, coherent six-publication gallery using only the six supplied publications.",
    "The complete body text is the primary source of meaning. Hashtags may carry meaning, but are neither privileged nor sufficient by themselves.",
    "Do not infer narrative meaning from image appearance, metadata, popularity, or unsupported assumptions.",
    "Use exact source IDs and exact quotations from each publication body. Do not invent or normalize quotations.",
    "Find a non-obvious shared relation or productive tension across all six texts; avoid a merely topical grouping.",
    "Return only the JSON object required by the supplied gallery response schema.",
    "CANDIDATE PUBLICATIONS:",
    JSON.stringify(promptPosts),
  ].join("\n\n");

  const compose = await generatePortfolioGallery(basePrompt, gallerySchema, {
    stage: "COMPOSE",
    candidateId,
  });
  modelUsed.push(...compose.model_used);
  result.model_used = modelUsed;
  result.composition = compose.data;
  result.stages_completed = ["COMPOSE"];

  const structural = validateGeminiGallery(compose.data);
  const semantic = validatePortfolioSemantics({ gallery: compose.data }, loaded.snapshot, sourceIds);
  result.compose_validation = {
    structural: structural.ok ? "PASS" : "FAIL",
    structural_errors: structural.errors,
    semantic: semantic.ok ? "PASS" : "FAIL",
    semantic_errors: semantic.errors,
  };
  if (!structural.ok || !semantic.ok) throw new Error("COMPOSE output did not pass the existing structural and semantic validators.");

  const validationContext: IndependentTestValidationContextV132 = {
    sourceTexts,
    composition: compose.data,
  };
  const testPrompt = [
    "You are the independent TEST stage for PEKHTOGRAPHY Portfolio. You did not compose this gallery.",
    "Evaluate the composition independently against all five criteria: semantic coherence, curatorial originality, narrative integrity, visual composition, and evidence integrity.",
    "Use only the six complete source texts and the supplied composition. Every finding must contain exactly one typed evidence reference with an exact verbatim quote.",
    "APPROVE only when the contract thresholds are met. Otherwise REJECT and provide at least one blocking issue and a blocking finding.",
    "Return only the JSON object required by the Independent TEST v1.3.2 schema.",
    "CANDIDATE ID:",
    candidateId,
    "SOURCE PUBLICATIONS:",
    JSON.stringify(promptPosts),
    "COMPOSITION:",
    JSON.stringify(compose.data),
  ].join("\n\n");

  const testOptions: Omit<PortfolioProviderOptions, "stage" | "candidateId" | "callId"> & {
    candidateId: string;
    validationContext: IndependentTestValidationContextV132;
  } = { candidateId, validationContext };
  const tested = await evaluateIndependentTest(testPrompt, testSchema, testOptions);
  modelUsed.push(...tested.model_used);
  result.model_used = modelUsed;
  result.independent_test = tested.data;
  result.stages_completed = ["COMPOSE", "TEST"];

  const testValidation = validateIndependentTestResponseV132(tested.data, validationContext);
  if (!testValidation.ok || tested.data.candidate_id !== candidateId) {
    result.test_validation = { status: "FAIL", errors: testValidation.errors };
    throw new Error("Independent TEST output did not pass the existing v1.3.2 runtime evidence validator.");
  }
  result.test_validation = { status: "PASS", errors: [] };
  result.status = "PROVIDER_SMOKE_PASS";
  result.interpretation = tested.data.decision === "APPROVE"
    ? "The independent TEST returned APPROVE and passed runtime evidence validation. This is not a production activation."
    : "The provider smoke test completed correctly; the independent TEST returned REJECT. No revision or publication was attempted.";
} catch (error) {
  result.status = "INCOMPLETE";
  result.error = error instanceof Error ? error.message : String(error);
  const prior = Array.isArray(result.model_used) ? result.model_used as ModelCallRecord[] : [];
  result.model_used = [...prior, ...diagnostics(error)];
}

await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  status: result.status,
  candidate_id: result.candidate_id,
  stages_completed: result.stages_completed,
  model_used: result.model_used,
  error: result.error ?? null,
  result_file: outputPath,
}, null, 2));
if (result.status !== "PROVIDER_SMOKE_PASS") process.exitCode = 1;
