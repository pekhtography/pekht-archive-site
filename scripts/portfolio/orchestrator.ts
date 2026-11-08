import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  validateGeminiOutput,
  validatePortfolioProcess,
  validatePortfolioSemantics,
  validateRunResult,
} from "./validation/index.ts";
import type {
  ModelCallRecord,
  PortfolioRunResult,
  ProcessAudit,
  ValidationFinding,
  ValidationStatus,
} from "./validation/types.ts";
import {
  generatePortfolioJson,
  type JsonSchema,
  type PortfolioProviderOptions,
} from "./provider.ts";
import { readPortfolioSnapshot, type LoadedPortfolioSnapshot } from "./snapshot.ts";

export interface PortfolioOrchestratorInput {
  snapshotPath: string;
  /** Existing globally shortlisted candidate; omit for a corpus-level NO_GALLERY decision. */
  candidateId?: string;
  /** Instruction text. Snapshot publication content is appended by the orchestrator. */
  prompt: string;
  /**
   * Audit evidence produced by the discovery/comparison pipeline.
   * The orchestrator appends this invocation's actual Provider records.
   */
  processAudit: Omit<ProcessAudit, "modelCalls"> & {
    modelCalls?: readonly ModelCallRecord[];
  };
  providerOptions?: Omit<PortfolioProviderOptions, "stage" | "candidateId">;
}

export interface PortfolioOrchestratorDependencies {
  readSnapshot?: (path: string) => Promise<LoadedPortfolioSnapshot>;
  generate?: typeof generatePortfolioJson;
  schema?: JsonSchema;
}

const SCHEMA_PATH = fileURLToPath(
  new URL("./schemas/gemini-output.schema.json", import.meta.url),
);

async function readDefaultSchema(): Promise<JsonSchema> {
  return JSON.parse(await readFile(SCHEMA_PATH, "utf8")) as JsonSchema;
}

function status(ok: boolean): ValidationStatus {
  return ok ? "PASS" : "FAIL";
}

function findingsFor(
  checkId: string,
  errors: readonly string[],
): ValidationFinding[] {
  return errors.map((message) => ({
    check_id: checkId,
    severity: "ERROR",
    message,
  }));
}

function diagnosticsFromError(error: unknown): ModelCallRecord[] {
  if (
    typeof error === "object" &&
    error !== null &&
    "model_used" in error &&
    Array.isArray(error.model_used)
  ) {
    // Provider owns these records. Do not infer or synthesize missing attempts.
    return error.model_used as ModelCallRecord[];
  }
  return [];
}

function buildIncompleteResult(
  inputSnapshot: LoadedPortfolioSnapshot["input_snapshot"],
  modelUsed: ModelCallRecord[],
  findings: ValidationFinding[],
): PortfolioRunResult {
  return {
    status: "INCOMPLETE",
    input_snapshot: inputSnapshot,
    gemini_output: null,
    validation: {
      status: "NOT_RUN",
      structural: "NOT_RUN",
      semantic: "NOT_RUN",
      process: "NOT_RUN",
      findings,
    },
    model_used: modelUsed,
  };
}

/**
 * Runs one provider composition request against a previously generated snapshot.
 *
 * Corpus-wide discovery/comparison evidence is supplied in processAudit; this
 * function validates that evidence but never claims that unperformed work ran.
 * No model request is made until this function is explicitly invoked.
 */
export async function runPortfolioOrchestrator(
  input: PortfolioOrchestratorInput,
  dependencies: PortfolioOrchestratorDependencies = {},
): Promise<PortfolioRunResult> {
  const loadSnapshot = dependencies.readSnapshot ?? readPortfolioSnapshot;
  const generate = dependencies.generate ?? generatePortfolioJson;

  const loaded = await loadSnapshot(input.snapshotPath);
  const schema = dependencies.schema ?? await readDefaultSchema();
  const publicationContext = loaded.snapshot.posts.map((post) => ({
    source_id: post.source_id,
    title: "title" in post ? post.title : "",
    body: post.body,
    hashtags: "hashtags" in post ? post.hashtags : [],
  }));
  const completePrompt = [
    input.prompt.trim(),
    "",
    "INPUT SNAPSHOT PUBLICATIONS (JSON; use body as the sole source for exact quotations):",
    JSON.stringify(publicationContext),
  ].join("\n");

  let generated: Awaited<ReturnType<typeof generate>>;
  try {
    generated = await generate(completePrompt, schema, {
      ...input.providerOptions,
      stage: input.candidateId ? "TEST" : "DISCOVER",
      candidateId: input.candidateId ?? null,
    });
  } catch (error) {
    const result = buildIncompleteResult(
      loaded.input_snapshot,
      [
        ...(input.processAudit.modelCalls ?? []),
        ...diagnosticsFromError(error),
      ],
      [{
        check_id: "PROVIDER_ERROR",
        severity: "ERROR",
        message: error instanceof Error ? error.message : String(error),
      }],
    );
    const checked = validateRunResult(result);
    if (!checked.ok) {
      throw new Error(`Invalid INCOMPLETE Portfolio run result: ${checked.errors.join("; ")}`);
    }
    return result;
  }

  const modelUsed = [
    ...(input.processAudit.modelCalls ?? []),
    ...generated.model_used,
  ];
  const structural = validateGeminiOutput(generated.data);
  const semantic = validatePortfolioSemantics(generated.data, loaded.snapshot);
  const process = validatePortfolioProcess({
    ...input.processAudit,
    modelCalls: modelUsed,
  });

  const findings = [
    ...findingsFor("STRUCTURAL_VALIDATION", structural.errors),
    ...findingsFor("SEMANTIC_VALIDATION", semantic.errors),
    ...findingsFor("PROCESS_VALIDATION", process.errors),
  ];
  const allPassed = structural.ok && semantic.ok && process.ok;
  const statusValue = allPassed
    ? generated.data.gallery === null ? "NO_GALLERY" : "APPROVED"
    : "INCOMPLETE";

  const result: PortfolioRunResult = {
    status: statusValue,
    input_snapshot: loaded.input_snapshot,
    // Preserve output only when it satisfies the declared Gemini output contract.
    gemini_output: structural.ok ? generated.data : null,
    validation: {
      status: status(allPassed),
      structural: status(structural.ok),
      semantic: status(semantic.ok),
      process: status(process.ok),
      findings,
    },
    model_used: modelUsed,
  };

  const checked = validateRunResult(result);
  if (!checked.ok) {
    throw new Error(`Invalid Portfolio run result: ${checked.errors.join("; ")}`);
  }
  return result;
}
