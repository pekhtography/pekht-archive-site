import test from "node:test";
import assert from "node:assert/strict";
import {
  generateJson,
  JournalBudgetExceededError,
  ProviderError,
} from "./provider.ts";

type LogEntry = { level: "info" | "warn"; message: string; details?: unknown };

async function withProviderHarness(
  run: (context: {
    calls: string[];
    waits: number[];
    logs: LogEntry[];
    setFetch: (handler: () => Promise<Response>) => void;
  }) => Promise<void>,
) {
  const envKeys = [
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GEMINI_FALLBACK_1",
    "GEMINI_FALLBACK_2",
    "GEMINI_FALLBACK_3",
    "GEMINI_FALLBACK_4",
  ] as const;
  const previousEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const calls: string[] = [];
  const waits: number[] = [];
  const logs: LogEntry[] = [];

  process.env.GEMINI_API_KEY = "provider-test-key";
  process.env.GEMINI_MODEL = "provider-test-primary";
  for (const key of envKeys.slice(2)) delete process.env[key];
  process.env.GEMINI_FALLBACK_1 = "provider-test-fallback";

  console.info = (message?: unknown, details?: unknown) => {
    logs.push({ level: "info", message: String(message), details });
  };
  console.warn = (message?: unknown, details?: unknown) => {
    logs.push({ level: "warn", message: String(message), details });
  };

  const setFetch = (handler: () => Promise<Response>) => {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return handler();
    };
  };

  try {
    await run({ calls, waits, logs, setFetch });
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.warn = originalWarn;
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function successResponse(value: unknown = { ok: true }) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("uses Google's retry delay from the 429 body and succeeds on the next attempt", async () => {
  await withProviderHarness(async ({ calls, waits, logs, setFetch }) => {
    let attempt = 0;
    setFetch(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message: "Please retry in 10.990056356s",
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }
      return successResponse();
    });

    const result = await generateJson("test prompt", {}, {
      sleepFn: async (ms) => { waits.push(ms); },
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [10_991]);
    assert.ok(logs.some((entry) =>
      entry.message === "[Gemini] retry scheduled" &&
      (entry.details as any)?.waitSource === "body" &&
      (entry.details as any)?.waitMs === 10_991
    ));
  });
});

test("prefers the Retry-After header over a retry delay in the response body", async () => {
  await withProviderHarness(async ({ waits, logs, setFetch }) => {
    let attempt = 0;
    setFetch(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response(
          JSON.stringify({ error: { message: "Please retry in 2s" } }),
          {
            status: 429,
            headers: { "Retry-After": "3", "content-type": "application/json" },
          },
        );
      }
      return successResponse();
    });

    await generateJson("test prompt", {}, {
      sleepFn: async (ms) => { waits.push(ms); },
    });

    assert.deepEqual(waits, [3_000]);
    assert.ok(logs.some((entry) =>
      entry.message === "[Gemini] retry scheduled" &&
      (entry.details as any)?.waitSource === "header"
    ));
  });
});

test("retries transient server errors three times, then falls back to the next model", async () => {
  await withProviderHarness(async ({ calls, waits, logs, setFetch }) => {
    setFetch(async () => {
      if (calls.length <= 3) {
        return new Response("temporary server failure", { status: 503 });
      }
      return successResponse({ model: "fallback" });
    });

    const result = await generateJson("test prompt", {}, {
      sleepFn: async (ms) => { waits.push(ms); },
    });

    assert.deepEqual(result, { model: "fallback" });
    assert.equal(calls.length, 4);
    assert.match(calls[0], /provider-test-primary/);
    assert.match(calls[3], /provider-test-fallback/);
    assert.deepEqual(waits, [1_000, 2_000]);
    assert.ok(logs.some((entry) =>
      entry.message === "[Gemini] model exhausted; fallback required"
    ));
    assert.ok(logs.some((entry) =>
      entry.message === "[Gemini] falling back to next model"
    ));
    assert.ok(logs.some((entry) =>
      entry.message === "[Gemini] model succeeded"
    ));
  });
});

test("does not fall back after a non-retryable HTTP error", async () => {
  await withProviderHarness(async ({ calls, setFetch }) => {
    setFetch(async () => new Response("invalid request", { status: 400 }));

    await assert.rejects(
      generateJson("test prompt", {}),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.status === 400 &&
        error.retryable === false,
    );
    assert.equal(calls.length, 1);
  });
});

test("checks the budget again after a retry wait and before another request", async () => {
  await withProviderHarness(async ({ calls, waits, setFetch }) => {
    setFetch(async () =>
      new Response("temporary server failure", { status: 503 }),
    );
    let budgetChecks = 0;

    await assert.rejects(
      generateJson("test prompt", {}, {
        checkBudget: () => ++budgetChecks <= 2,
        sleepFn: async (ms) => { waits.push(ms); },
      }),
      (error: unknown) => error instanceof JournalBudgetExceededError,
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(waits, [1_000]);
    assert.equal(budgetChecks, 3);
  });
});


test("skips a model immediately when Google explicitly reports a daily request quota", async () => {
  await withProviderHarness(async ({ calls, waits, logs, setFetch }) => {
    setFetch(async () => {
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Generate content requests per day limit exceeded on Free Tier. Please retry in 13h.",
          },
        }), { status: 429, headers: { "content-type": "application/json" } });
      }
      return successResponse({ model: "fallback" });
    });
    const result = await generateJson("test prompt", {}, { sleepFn: async (ms) => { waits.push(ms); } });
    assert.deepEqual(result, { model: "fallback" });
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, []);
    assert.ok(logs.some((entry) => entry.message === "[Gemini] falling back to next model"));
  });
});

test("retries a short RPM limit on the same model", async () => {
  await withProviderHarness(async ({ calls, waits, setFetch }) => {
    setFetch(async () => {
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Requests per minute quota exceeded. Please retry in 2s" },
        }), { status: 429, headers: { "content-type": "application/json" } });
      }
      return successResponse();
    });
    await generateJson("test prompt", {}, { sleepFn: async (ms) => { waits.push(ms); } });
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [2_000]);
    assert.match(calls[0], /provider-test-primary/);
    assert.match(calls[1], /provider-test-primary/);
  });
});


test("records provider usage metadata and request diagnostics without estimating missing token counts", async () => {
  await withProviderHarness(async ({ logs, setFetch }) => {
    setFetch(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: true }) }] } }],
      usageMetadata: { promptTokenCount: 123, candidatesTokenCount: 45, totalTokenCount: 168, cachedContentTokenCount: 12 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await generateJson("diagnostic prompt", {}, { runId: "run-123", stage: "DISCOVER" });
    const entry = logs.find((item) => item.message === "JOURNAL_PROVIDER_DIAGNOSTIC:");
    assert.ok(entry);
    const metric = JSON.parse(String((entry.details as any)));
    assert.equal(metric.run_id, "run-123");
    assert.equal(metric.stage, "DISCOVER");
    assert.equal(metric.input_tokens, 123);
    assert.equal(metric.output_tokens, 45);
    assert.equal(metric.total_tokens, 168);
    assert.equal(metric.cached_input_tokens, 12);
    assert.equal(metric.prompt_chars, "diagnostic prompt".length);
    assert.equal(metric.prompt_bytes, Buffer.byteLength("diagnostic prompt", "utf8"));
  });
});

test("leaves token metrics null when usageMetadata is absent", async () => {
  await withProviderHarness(async ({ logs, setFetch }) => {
    setFetch(async () => successResponse());
    await generateJson("no usage metadata", {}, { stage: "TEST" });
    const entry = logs.find((item) => item.message === "JOURNAL_PROVIDER_DIAGNOSTIC:");
    assert.ok(entry);
    const metric = JSON.parse(String((entry.details as any)));
    assert.equal(metric.input_tokens, null);
    assert.equal(metric.output_tokens, null);
    assert.equal(metric.total_tokens, null);
  });
});

test("classifies structured input_token_count quota details as TPM", async () => {
  await withProviderHarness(async ({ calls, logs, setFetch }) => {
    setFetch(async () => {
      if (calls.length === 1) return new Response(JSON.stringify({
        error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ reason: "RATE_LIMIT_EXCEEDED", metadata: { quota_metric: "generativelanguage.googleapis.com/generate_content_input_token_count" } }], message: "Quota exceeded" },
      }), { status: 429, headers: { "content-type": "application/json" } });
      return successResponse({ fallback: true });
    });
    await generateJson("test prompt", {}, { sleepFn: async () => {} });
    const entry = logs.find((item) => item.message === "JOURNAL_PROVIDER_DIAGNOSTIC:");
    assert.ok(entry);
    assert.equal(JSON.parse(String((entry.details as any))).quota_type, "tpm");
  });
});

test("classifies structured requests-per-minute quota details as RPM", async () => {
  await withProviderHarness(async ({ calls, logs, setFetch }) => {
    setFetch(async () => {
      if (calls.length === 1) return new Response(JSON.stringify({
        error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ metadata: { quota_metric: "generativelanguage.googleapis.com/generate_content_requests" } }], message: "Quota exceeded" },
      }), { status: 429, headers: { "content-type": "application/json" } });
      return successResponse({ fallback: true });
    });
    await generateJson("test prompt", {}, { sleepFn: async () => {} });
    const entry = logs.find((item) => item.message === "JOURNAL_PROVIDER_DIAGNOSTIC:");
    assert.ok(entry);
    assert.equal(JSON.parse(String((entry.details as any))).quota_type, "rpm");
  });
});
