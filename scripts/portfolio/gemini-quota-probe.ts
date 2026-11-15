import { writeFile } from "node:fs/promises";

const outputPath = process.env.GEMINI_PROBE_RESULT_PATH ?? "gemini-quota-probe-result.json";
const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
const apiKey = process.env.GEMINI_API_KEY ?? "";

const result: Record<string, unknown> = {
  status: "NOT_RUN",
  purpose: "Single-request Gemini quota availability probe; no fallback and no retries.",
  model: model || null,
  request_count: 0,
  retry_after: null,
  http_status: null,
};

function safeMessage(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(x-goog-api-key|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s]+/gi, "[URL]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

try {
  if (!model) throw new Error("GEMINI_MODEL is empty; no request was sent.");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured; no request was sent.");

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";
  result.request_count = 1;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: 'Return a JSON object with the property probe set to "ok".' }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { probe: { type: "STRING" } },
          required: ["probe"],
        },
        thinkingConfig: { thinkingLevel: "low" },
        maxOutputTokens: 256,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  result.http_status = response.status;
  result.retry_after = response.headers.get("Retry-After");
  if (response.ok) {
    const payload = await response.json() as {
      candidates?: Array<{
        finishReason?: unknown;
        content?: { parts?: Array<{ text?: unknown }> };
      }>;
      usageMetadata?: Record<string, unknown>;
    };
    const candidate = payload.candidates?.[0];
    const responseText = candidate?.content?.parts
      ?.map((part) => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim() ?? "";
    result.status = "HTTP_200";
    result.finish_reason = typeof candidate?.finishReason === "string"
      ? candidate.finishReason
      : null;
    result.response_text = responseText;
    result.json_valid = false;
    result.probe_value = null;
    try {
      const parsed = JSON.parse(responseText) as { probe?: unknown };
      result.json_valid = true;
      result.probe_value = parsed.probe ?? null;
    } catch {
      result.json_valid = false;
    }
    result.usage_metadata = payload.usageMetadata ?? null;
  } else {
    result.status = response.status === 429 ? "QUOTA_LIMITED" : "HTTP_ERROR";
    result.error = safeMessage(await response.text());
  }
} catch (error) {
  result.status = "PROBE_ERROR";
  result.error = safeMessage(error instanceof Error ? error.message : String(error));
}

await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));
if (result.status !== "HTTP_200" || result.finish_reason !== "STOP" || result.json_valid !== true || result.probe_value !== "ok") process.exitCode = 1;
