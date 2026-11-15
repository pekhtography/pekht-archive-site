import { writeFile } from "node:fs/promises";

const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
const apiKey = process.env.GEMINI_API_KEY ?? "";
const outputPath = process.env.GEMINI_DIAGNOSTIC_RESULT_PATH ?? "gemini-schema-diagnostic.json";

const fullSchema = {
  type: "object",
  required: ["records"],
  properties: {
    records: {
      type: "array",
      minItems: 100,
      maxItems: 100,
      items: {
        type: "object",
        required: ["source_index", "result", "observations"],
        properties: {
          source_index: { type: "integer" },
          result: { type: "string", enum: ["SIGNALS_FOUND", "NO_SIGNAL"] },
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
                      source: { type: "string", enum: ["BODY"] },
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
} as const;

const minimalSchema = {
  type: "object",
  required: ["probe"],
  properties: { probe: { type: "string" } }
} as const;

const syntheticPublications = Array.from({ length: 100 }, (_, source_index) => ({
  source_index,
  title: `Synthetic diagnostic item ${source_index + 1}`,
  body: `This synthetic text is included only to test Gemini schema acceptance. Item ${source_index + 1} contains a quiet observation of light and shadow.`
}));
const prompt = [
  "This is a provider/schema diagnostic only. The supplied items are synthetic, not real archive publications.",
  "Return exactly one record per supplied item, preserving its source_index.",
  "For each item use result NO_SIGNAL and observations []. Return JSON only.",
  "SYNTHETIC ITEMS:",
  JSON.stringify(syntheticPublications)
].join("\n\n");

type ProbeCase = { name: string; schema: typeof minimalSchema | typeof fullSchema; thinking?: "low"; maxOutputTokens?: number };
const cases: ProbeCase[] = [
  { name: "minimal_schema", schema: minimalSchema },
  { name: "full_schema_baseline", schema: fullSchema },
  { name: "full_schema_thinking_low", schema: fullSchema, thinking: "low" },
  { name: "full_schema_max_output_256", schema: fullSchema, maxOutputTokens: 256 }
];

function safe(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(x-goog-api-key|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s]+/gi, "[URL]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

const results: Array<Record<string, unknown>> = [];
for (const test of cases) {
  const item: Record<string, unknown> = {
    name: test.name, model, request_count: 0, status: "NOT_RUN",
    schema_mode: test.schema === minimalSchema ? "minimal" : "full_discover"
  };
  if (!apiKey) {
    item.status = "CONFIG_ERROR";
    item.error = "GEMINI_API_KEY is not configured; no requests were sent.";
    results.push(item);
    break;
  }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    item.request_count = 1;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: test.schema === minimalSchema
          ? 'Return JSON exactly as {"probe":"ok"}.'
          : prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: test.schema,
          ...(test.thinking ? { thinkingConfig: { thinkingLevel: test.thinking } } : {}),
          ...(test.maxOutputTokens !== undefined ? { maxOutputTokens: test.maxOutputTokens } : {})
        }
      }),
      signal: AbortSignal.timeout(120_000)
    });
    item.http_status = response.status;
    item.retry_after = response.headers.get("Retry-After");
    if (response.ok) {
      const payload = await response.json() as {
        candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown }> } }>;
        usageMetadata?: Record<string, unknown>;
      };
      const candidate = payload.candidates?.[0];
      const responseText = candidate?.content?.parts?.map(part => typeof part.text === "string" ? part.text : "").join("").trim() ?? "";
      item.status = "HTTP_200";
      item.finish_reason = typeof candidate?.finishReason === "string" ? candidate.finishReason : null;
      item.response_text_preview = responseText.slice(0, 500);
      item.usage_metadata = payload.usageMetadata ?? null;
      try { JSON.parse(responseText); item.json_valid = true; }
      catch { item.json_valid = false; }
    } else {
      item.status = response.status === 429 ? "QUOTA_LIMITED" : "HTTP_ERROR";
      item.error = safe(await response.text());
    }
  } catch (error) {
    item.status = "PROBE_ERROR";
    item.error = safe(error instanceof Error ? error.message : String(error));
  }
  results.push(item);
}

const output = {
  purpose: "Four isolated Gemini schema/configuration diagnostics using synthetic input only; no archive snapshot or production DISCOVER execution.",
  model, total_requests: results.reduce((sum, item) => sum + Number(item.request_count ?? 0), 0),
  cases: results
};
await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify(output, null, 2));
if (results.length !== cases.length || results.some(item => item.status !== "HTTP_200")) process.exitCode = 1;
