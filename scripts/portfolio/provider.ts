import { randomUUID } from "node:crypto";
import type { GeminiOutput, ModelCallRecord, PortfolioStage } from "./validation/types.ts";

export type JsonSchema = Record<string, unknown>;
export type ProviderFetch = typeof fetch;

export interface PortfolioProviderOptions {
  stage: PortfolioStage;
  candidateId?: string | null;
  callId?: string;
  timeoutMs?: number;
  maxAttemptsPerModel?: number;
  maxRetryDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  fetchFn?: ProviderFetch;
}

export interface PortfolioProviderResult {
  data: GeminiOutput;
  model_used: ModelCallRecord[];
}

export interface PortfolioProviderErrorOptions {
  retryable: boolean;
  model: string;
  attempts: number;
  status?: number | null;
  quotaType?: "daily" | "tpm" | "rpm" | "unknown" | null;
  model_used?: ModelCallRecord[];
  cause?: unknown;
}

export class PortfolioProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly model: string;
  readonly attempts: number;
  readonly quotaType: "daily" | "tpm" | "rpm" | "unknown" | null;
  readonly model_used: ModelCallRecord[];

  constructor(message: string, options: PortfolioProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "PortfolioProviderError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.model = options.model;
    this.attempts = options.attempts;
    this.quotaType = options.quotaType ?? null;
    this.model_used = [...(options.model_used ?? [])];
  }
}

export class PortfolioModelsExhaustedError extends PortfolioProviderError {
  constructor(modelUsed: ModelCallRecord[], cause?: unknown) {
    const last = modelUsed.at(-1);
    super(
      `INCOMPLETE: all configured Portfolio Gemini models were exhausted (${modelUsed.map((entry) => entry.model).join(", ")}).`,
      {
        retryable: true,
        model: last?.model ?? "unknown",
        attempts: last?.attempts ?? 0,
        model_used: modelUsed,
        cause,
      },
    );
    this.name = "PortfolioModelsExhaustedError";
  }
}

const DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
] as const;

function configuredModels(): string[] {
  const configured = [
    process.env.GEMINI_MODEL,
    process.env.GEMINI_FALLBACK_1,
    process.env.GEMINI_FALLBACK_2,
    process.env.GEMINI_FALLBACK_3,
    process.env.GEMINI_FALLBACK_4,
  ].filter((value): value is string => Boolean(value?.trim()));

  const selected = configured.length > 0 ? configured : [...DEFAULT_MODELS];
  return selected.filter((model, index) => selected.indexOf(model) === index);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyQuota(errorText: string): "daily" | "tpm" | "rpm" | "unknown" {
  let searchable = errorText;
  try {
    const parsed = JSON.parse(errorText);
    searchable += " " + JSON.stringify(parsed?.error?.details ?? parsed?.error?.status ?? "");
  } catch {
    // The bounded raw response remains available for classification.
  }

  const normalized = searchable.replace(/[_-]+/g, " ");
  if (/requests?\s+per\s+day|per\s+day\s+(?:request\s+)?quota|daily\s+(?:request\s+)?quota|\bRPD\b|generate\s+content\s+requests\s+per\s+day/i.test(normalized)) return "daily";
  if (/tokens?\s+per\s+minute|\bTPM\b|input[_\s-]*token[_\s-]*count|tokens_per_minute|generate_content_input_token/i.test(searchable)) return "tpm";
  if (/requests?\s+per\s+minute|\bRPM\b|requests_per_minute|generate_content_requests/i.test(searchable)) return "rpm";
  return "unknown";
}

function retryAfterMs(response: Response, errorText: string): number | null {
  const header = response.headers.get("Retry-After");
  if (header) {
    const value = header.trim();
    if (/^\d+$/.test(value)) {
      const seconds = Number(value);
      if (Number.isSafeInteger(seconds)) return seconds * 1000;
    } else {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now());
    }
  }

  const match =
    errorText.match(/Please retry in\s+([\d.]+)\s*s/i) ??
    errorText.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}

function responseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== "object") return "";
  const content = (candidates[0] as { content?: unknown }).content;
  if (!content || typeof content !== "object") return "";
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? (part as { text: string }).text
      : "")
    .join("")
    .trim();
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "ETIMEDOUT");
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function requestModel(
  model: string,
  prompt: string,
  schema: JsonSchema,
  options: PortfolioProviderOptions,
): Promise<{ data: GeminiOutput; attempts: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new PortfolioProviderError("GEMINI_API_KEY is not configured.", {
      retryable: false, model, attempts: 0,
    });
  }

  const maxAttempts = options.maxAttemptsPerModel ?? 3;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 120_000;
  const fetcher = options.fetchFn ?? fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema },
  });

  let lastError = "Unknown Gemini provider error";
  let lastStatus: number | null = null;
  let lastQuota: "daily" | "tpm" | "rpm" | "unknown" | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let delayMs: number | null = null;
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });

      if (response.ok) {
        const payload: unknown = await response.json();
        const text = responseText(payload);
        if (!text) {
          throw new PortfolioProviderError(`Gemini model ${model} returned no JSON text.`, {
            retryable: false, model, attempts: attempt, status: response.status,
          });
        }
        try {
          return { data: JSON.parse(text) as GeminiOutput, attempts: attempt };
        } catch (error) {
          throw new PortfolioProviderError(`Gemini model ${model} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`, {
            retryable: false, model, attempts: attempt, status: response.status, cause: error,
          });
        }
      }

      const errorText = (await response.text()).slice(0, 2_000);
      lastError = errorText || `HTTP ${response.status}`;
      lastStatus = response.status;
      const retryable = response.status === 429 || response.status === 408 || response.status >= 500;

      if (response.status === 429) {
        lastQuota = classifyQuota(errorText);
        delayMs = retryAfterMs(response, errorText);
        if (lastQuota === "daily" || (delayMs !== null && delayMs > maxRetryDelayMs)) {
          throw new PortfolioProviderError(
            `Gemini ${model} quota/delay requires model fallback (${lastQuota}).`,
            { retryable: true, model, attempts: attempt, status: response.status, quotaType: lastQuota },
          );
        }
      }

      if (!retryable) {
        throw new PortfolioProviderError(`Gemini ${model} failed with HTTP ${response.status}: ${lastError}`, {
          retryable: false, model, attempts: attempt, status: response.status,
        });
      }
    } catch (error) {
      if (error instanceof PortfolioProviderError) throw error;
      if (isAbort(error)) {
        throw new PortfolioProviderError(`Gemini request for ${model} was aborted: ${error.message}`, {
          retryable: false, model, attempts: attempt, cause: error,
        });
      }
      if (!isTimeout(error) && !(error instanceof TypeError)) throw error;
      lastError = error instanceof Error ? error.message : String(error);
      lastStatus = null;
      lastQuota = null;
    }

    if (attempt < maxAttempts) {
      const waitMs = delayMs ?? 1_000 * 2 ** (attempt - 1);
      try {
        await (options.sleepFn ?? sleep)(waitMs);
      } catch (cause) {
        // The request above did happen; a failed backoff must not erase its attempt count.
        throw new PortfolioProviderError(
          `Gemini retry backoff for ${model} failed after attempt ${attempt}: ${cause instanceof Error ? cause.message : String(cause)}`,
          {
            retryable: true,
            model,
            attempts: attempt,
            status: lastStatus,
            quotaType: lastQuota,
            cause,
          },
        );
      }
    }
  }

  throw new PortfolioProviderError(`Gemini ${model} exhausted ${maxAttempts} attempts: ${lastError}`, {
    retryable: true, model, attempts: maxAttempts, status: lastStatus, quotaType: lastQuota,
  });
}

/**
 * Calls Gemini's generateContent endpoint and records every model attempted.
 * Tests inject fetchFn; production uses global fetch. No API request occurs on import.
 */
export async function generatePortfolioJson(
  prompt: string,
  schema: JsonSchema,
  options: PortfolioProviderOptions,
): Promise<PortfolioProviderResult> {
  const modelList = configuredModels();
  const callId = options.callId ?? randomUUID();
  const candidateId = options.candidateId ?? null;
  const modelUsed: ModelCallRecord[] = [];
  let lastError: unknown = null;

  for (let fallbackIndex = 0; fallbackIndex < modelList.length; fallbackIndex += 1) {
    const model = modelList[fallbackIndex];
    try {
      const result = await requestModel(model, prompt, schema, options);
      modelUsed.push({
        call_id: callId,
        stage: options.stage,
        candidate_id: candidateId,
        model,
        fallback_index: fallbackIndex,
        attempts: result.attempts,
        outcome: "SUCCESS",
      });
      return { data: result.data, model_used: modelUsed };
    } catch (error) {
      if (error instanceof PortfolioProviderError) {
        if (error.attempts > 0) {
          modelUsed.push({
            call_id: callId,
            stage: options.stage,
            candidate_id: candidateId,
            model,
            fallback_index: fallbackIndex,
            attempts: error.attempts,
            outcome: error.retryable && fallbackIndex < modelList.length - 1 ? "FALLBACK" : "FAILED",
          });
        }
        if (!error.retryable) {
          throw new PortfolioProviderError(error.message, {
            retryable: false,
            model: error.model,
            attempts: error.attempts,
            status: error.status,
            quotaType: error.quotaType,
            model_used: modelUsed,
            cause: error,
          });
        }
        lastError = error;
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      modelUsed.push({
        call_id: callId,
        stage: options.stage,
        candidate_id: candidateId,
        model,
        fallback_index: fallbackIndex,
        attempts: 1,
        outcome: "FAILED",
      });
      throw new PortfolioProviderError(`Unexpected Gemini provider failure for ${model}: ${message}`, {
        retryable: false,
        model,
        attempts: 1,
        model_used: modelUsed,
        cause: error,
      });
    }
  }

  throw new PortfolioModelsExhaustedError(modelUsed, lastError);
}
