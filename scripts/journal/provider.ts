export type JsonSchema = Record<string, unknown>;

export type GenerateJsonOptions = {
  /** Return false to stop before starting another HTTP request. */
  checkBudget?: () => boolean;
  /** Internal test seam; production defaults to 60 seconds. */
  timeoutMs?: number;
  /** Internal test seam for retry-delay tests; production uses real timers. */
  sleepFn?: (ms: number) => Promise<void>;
};

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly model: string;

  constructor(message: string, options: { retryable: boolean; status?: number | null; model: string }) {
    super(message);
    this.name = "ProviderError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.model = options.model;
  }
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

  return [...configured, ...defaults].filter((model, index, list) => list.indexOf(model) === index);
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
    errorText.match(/Please retry in\\s+([\\d.]+)\\s*s/i) ??
    errorText.match(/"retryDelay"\\s*:\\s*"([\\d.]+)s"/i);

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

  let lastError = "";
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    checkBudget(options);
    let retryDelayMs: number | null = null;
    let retryDelaySource: "header" | "body" | "backoff" = "backoff";

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });

      if (response.ok) {
        const payload = await response.json() as any;
        const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("")?.trim();
        if (!text) throw new ProviderError(`Model ${model} returned no text.`, { retryable: false, model });
        try {
          return JSON.parse(text);
        } catch {
          throw new ProviderError(`Model ${model} returned invalid JSON.`, { retryable: false, model });
        }
      }

      const errorText = await response.text();
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
        retryDelayMs = parseRetryAfterMs(response.headers.get("Retry-After"));
        if (retryDelayMs !== null) {
          retryDelaySource = "header";
        } else {
          retryDelayMs = parseRetryDelayFromError(errorText);
          if (retryDelayMs !== null) retryDelaySource = "body";
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

  throw lastError instanceof Error ? lastError : new Error("No AI provider model succeeded.");
}
