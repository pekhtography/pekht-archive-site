export type JsonSchema = Record<string, unknown>;

export type JournalStage = "DISCOVER" | "SELECT-MONTAGE" | "TEST" | "TITLE CUT";
export type ProviderDiagnostic = {
  run_id: string; stage: JournalStage | "UNSPECIFIED"; model: string; attempt: number;
  prompt_chars: number; prompt_bytes: number; request_bytes: number; duration_ms: number;
  http_status: number | null; input_tokens: number | null; output_tokens: number | null;
  total_tokens: number | null; cached_input_tokens: number | null;
  quota_type: "daily" | "tpm" | "rpm" | "unknown" | null;
};
export type GenerateJsonOptions = {
  /** Return false to stop before starting another HTTP request. */
  checkBudget?: () => boolean;
  runId?: string;
  stage?: JournalStage;
  onDiagnostic?: (metric: ProviderDiagnostic) => void;
  /** Internal test seam; production defaults to 60 seconds. */
  timeoutMs?: number;
  /** Internal test seam for retry-delay tests; production uses real timers. */
  sleepFn?: (ms: number) => Promise<void>;
};

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly model: string;
  readonly quotaType: "daily" | "tpm" | "rpm" | "unknown" | null;

  constructor(message: string, options: { retryable: boolean; status?: number | null; model: string; quotaType?: "daily" | "tpm" | "rpm" | "unknown" | null }) {
    super(message);
    this.name = "ProviderError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.model = options.model;
    this.quotaType = options.quotaType ?? null;
  }
}

export class ProviderModelsExhaustedError extends Error {
  readonly models: string[];

  constructor(models: string[], cause?: unknown) {
    super(`INCOMPLETE: all configured Gemini models were exhausted (${models.join(", ")}).`, { cause });
    this.name = "ProviderModelsExhaustedError";
    this.models = models;
  }
}

function classifyQuota(errorText: string): "daily" | "tpm" | "rpm" | "unknown" {
  let searchable = errorText;
  try {
    const parsed = JSON.parse(errorText);
    searchable += " " + JSON.stringify(parsed?.error?.details ?? parsed?.error?.status ?? "");
  } catch { /* classify the bounded plain-text response */ }
  if (/requests?\s+per\s+day|per-day\s+(?:request\s+)?quota|daily\s+(?:request\s+)?quota|RPD|generate\s+content\s+requests\s+per\s+day/i.test(searchable)) return "daily";
  if (/tokens?\s+per\s+minute|\bTPM\b|input[_\s-]*token[_\s-]*count|tokens_per_minute|generate_content_input_token/i.test(searchable)) return "tpm";
  if (/requests?\s+per\s+minute|\bRPM\b|requests_per_minute|generate_content_requests/i.test(searchable)) return "rpm";
  return "unknown";
}

export class JournalBudgetExceededError extends Error {
  constructor() {
    super("JOURNAL_BUDGET_EXCEEDED before model request");
    this.name = "JournalBudgetExceededError";
  }
}

function models(): string[] {
  const configured = [
    process.env.GEMINI_MODEL,
    process.env.GEMINI_FALLBACK_1,
    process.env.GEMINI_FALLBACK_2,
    process.env.GEMINI_FALLBACK_3,
    process.env.GEMINI_FALLBACK_4,
  ].filter(Boolean) as string[];

  const defaults = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ];

  // Explicit configuration is authoritative; otherwise use the default chain.
  // gemini-3.5-flash-lite intentionally remains the final default fallback.
  const selected = configured.length > 0 ? configured : defaults;
  return selected.filter((model, index, list) => list.indexOf(model) === index);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();

  // Retry-After permits delta-seconds or an HTTP date.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds * 1000 : null;
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

function parseRetryDelayFromError(errorText: string): number | null {
  const match =
    errorText.match(/Please retry in\s+([\d.]+)\s*s/i) ??
    errorText.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);

  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds * 1000)
    : null;
}

function errorSummary(errorText: string, maxLength = 800): string {
  try {
    const parsed = JSON.parse(errorText);
    const apiError = parsed?.error;
    if (apiError && typeof apiError === "object") {
      const parts = [
        apiError.code != null ? `code=${apiError.code}` : null,
        typeof apiError.status === "string" ? `status=${apiError.status}` : null,
        typeof apiError.message === "string" ? apiError.message : null,
      ].filter(Boolean);
      if (parts.length > 0) return parts.join(" | ").slice(0, maxLength);
    }
  } catch {
    // Keep a bounded plain-text summary for non-JSON responses.
  }
  return errorText.slice(0, maxLength);
}

function checkBudget(options: GenerateJsonOptions) {
  if (options.checkBudget && !options.checkBudget()) {
    throw new JournalBudgetExceededError();
  }
}

async function requestModel(
  model: string,
  prompt: string,
  schema: JsonSchema,
  options: GenerateJsonOptions,
): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError("GEMINI_API_KEY is not configured.", { retryable: false, model });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };
  const serializedBody = JSON.stringify(body);
  const runId = options.runId ?? process.env.GITHUB_RUN_ID ?? "local";
  const stage = options.stage ?? "UNSPECIFIED";
  const emitDiagnostic = (metric: ProviderDiagnostic) => {
    console.info("JOURNAL_PROVIDER_DIAGNOSTIC:", JSON.stringify(metric));
    try { options.onDiagnostic?.(metric); } catch (error) {
      console.warn("[Gemini] diagnostic callback failed", error);
    }
  };

  let lastError = "";
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    checkBudget(options);
    let retryDelayMs: number | null = null;
    let retryDelaySource: "header" | "body" | "backoff" = "backoff";

    const requestStartedAt = Date.now();
    let metricEmitted = false;
    const emitAttempt = (values: Partial<ProviderDiagnostic>) => {
      if (metricEmitted) return;
      metricEmitted = true;
      emitDiagnostic({
        run_id: runId, stage, model, attempt: attempt + 1,
        prompt_chars: prompt.length, prompt_bytes: Buffer.byteLength(prompt, "utf8"),
        request_bytes: Buffer.byteLength(serializedBody, "utf8"),
        duration_ms: Date.now() - requestStartedAt, http_status: null,
        input_tokens: null, output_tokens: null, total_tokens: null,
        cached_input_tokens: null, quota_type: null, ...values,
      });
    };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: serializedBody,
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });

      if (response.ok) {
        const payload = await response.json() as any;
        const usage = payload?.usageMetadata ?? {};
        emitAttempt({
          http_status: response.status,
          input_tokens: Number.isFinite(usage.promptTokenCount) ? usage.promptTokenCount : null,
          output_tokens: Number.isFinite(usage.candidatesTokenCount) ? usage.candidatesTokenCount : null,
          total_tokens: Number.isFinite(usage.totalTokenCount) ? usage.totalTokenCount : null,
          cached_input_tokens: Number.isFinite(usage.cachedContentTokenCount) ? usage.cachedContentTokenCount : null,
        });
        const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("")?.trim();
        if (!text) throw new ProviderError(`Model ${model} returned no text.`, { retryable: false, model });
        try {
          return JSON.parse(text);
        } catch {
          throw new ProviderError(`Model ${model} returned invalid JSON.`, { retryable: false, model });
        }
      }

      const errorText = await response.text();
      emitAttempt({ http_status: response.status, quota_type: response.status === 429 ? classifyQuota(errorText) : null });
      lastError = errorText.slice(0, 1000);
      lastStatus = response.status;

      if (response.status === 404) {
        console.warn("[Gemini] model unavailable", {
          model,
          attempt: attempt + 1,
          maxAttempts: 3,
          status: response.status,
          retryable: true,
          error: errorSummary(errorText),
        });
        throw new ProviderError(`Gemini model ${model} is unavailable: ${lastError}`, {
          retryable: true,
          status: response.status,
          model,
        });
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (response.status === 429) {
        const quotaType = classifyQuota(errorText);
        retryDelayMs = parseRetryAfterMs(response.headers.get("Retry-After"));
        if (retryDelayMs !== null) {
          retryDelaySource = "header";
        } else {
          retryDelayMs = parseRetryDelayFromError(errorText);
          if (retryDelayMs !== null) retryDelaySource = "body";
        }

        // A confirmed daily quota cannot recover during this run. For an unknown
        // quota with a very long Retry-After, avoid blocking the entire run.
        if (quotaType === "daily" || (quotaType === "unknown" && retryDelayMs !== null && retryDelayMs > 120_000)) {
          throw new ProviderError(
            `Gemini ${model} quota exhausted (${quotaType}); skipping to the next model.`,
            { retryable: true, status: response.status, model, quotaType },
          );
        }
      }
      console.warn("[Gemini] HTTP request failed", {
        model,
        attempt: attempt + 1,
        maxAttempts: 3,
        status: response.status,
        retryable,
        error: errorSummary(errorText),
      });
      if (!retryable) {
        throw new ProviderError(`Gemini ${model} failed with HTTP ${response.status}: ${lastError}`, {
          retryable: false,
          status: response.status,
          model,
        });
      }
    } catch (error) {
      if (error instanceof JournalBudgetExceededError) throw error;
      if (error instanceof ProviderError) throw error;

      const name = error instanceof Error ? error.name : "";
      // Caller cancellation is not a transient timeout and must never trigger retry/fallback.
      if (name === "AbortError") throw error;

      if (name !== "TimeoutError" && !(error instanceof TypeError)) throw error;

      lastError = error instanceof Error ? error.message : String(error);
      lastStatus = null;
      emitAttempt({ http_status: null });
      console.warn("[Gemini] network request failed", {
        model,
        attempt: attempt + 1,
        maxAttempts: 3,
        status: "none",
        errorType: name || "UnknownError",
        error: lastError.slice(0, 800),
        retryable: true,
      });
    }

    if (attempt < 2) {
      const delayMs = retryDelayMs ?? 1000 * 2 ** attempt;
      console.info("[Gemini] retry scheduled", {
        model,
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        waitMs: delayMs,
        waitSource: retryDelaySource,
      });
      if (retryDelayMs !== null && !options.sleepFn) {
        // Long Retry-After values must not block budget checks for the entire wait.
        let remainingMs = delayMs;
        while (remainingMs > 0) {
          checkBudget(options);
          const chunkMs = Math.min(remainingMs, 1000);
          await sleep(chunkMs);
          remainingMs -= chunkMs;
        }
      } else {
        await (options.sleepFn ?? sleep)(delayMs);
      }
    }
  }

  throw new ProviderError(`Gemini ${model} exhausted retries: ${lastError}`, {
    retryable: true,
    status: lastStatus,
    model,
  });
}

export async function generateJson(
  prompt: string,
  schema: JsonSchema,
  options: GenerateJsonOptions = {},
): Promise<any> {
  let lastError: unknown = null;

  const modelList = models();
  for (let index = 0; index < modelList.length; index += 1) {
    const model = modelList[index];
    checkBudget(options);
    try {
      const result = await requestModel(model, prompt, schema, options);
      console.info("[Gemini] model succeeded", { model });
      return result;
    } catch (error) {
      if (error instanceof JournalBudgetExceededError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (!(error instanceof ProviderError)) throw error;
      if (!error.retryable) throw error;
      lastError = error;
      console.warn("[Gemini] model exhausted; fallback required", {
        model,
        retryable: error.retryable,
        status: error.status,
      });
      const nextModel = modelList[index + 1];
      if (nextModel) {
        console.info("[Gemini] falling back to next model", {
          from: model,
          to: nextModel,
        });
      }
    }
  }

  throw new ProviderModelsExhaustedError(modelList, lastError);
}
