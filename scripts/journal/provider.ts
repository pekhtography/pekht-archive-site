export type JsonSchema = Record<string, unknown>;

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

function models(): string[] {
  return [
    process.env.GEMINI_MODEL || "gemini-3.8-flash",
    process.env.GEMINI_FALLBACK_1 || "gemini-3.5-flash",
    process.env.GEMINI_FALLBACK_2 || "gemini-2.5-flash",
  ].filter(Boolean);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestModel(model: string, prompt: string, schema: JsonSchema): Promise<unknown> {
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
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
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) {
      throw new ProviderError(`Gemini ${model} failed with HTTP ${response.status}: ${lastError}`, {
        retryable: false,
        status: response.status,
        model,
      });
    }

    if (attempt < 2) await sleep(1000 * 2 ** attempt);
  }

  throw new ProviderError(`Gemini ${model} exhausted retries: ${lastError}`, {
    retryable: true,
    status: 429,
    model,
  });
}

export async function generateJson(prompt: string, schema: JsonSchema): Promise<any> {
  let lastError: unknown = null;

  for (const model of models()) {
    try {
      return await requestModel(model, prompt, schema);
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderError && !error.retryable) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("No AI provider model succeeded.");
}
