import assert from "node:assert/strict";
import test from "node:test";
import { generatePortfolioJson } from "./provider.ts";

const envKeys = [
  "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_1",
  "GEMINI_FALLBACK_2", "GEMINI_FALLBACK_3", "GEMINI_FALLBACK_4",
] as const;

const output = {
  gallery: null,
  test: { decision: "REJECT", findings: ["No coherent gallery"], revision_cycles: 0 },
};

function okResponse(value: unknown = output): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function withHarness(
  run: (context: { waits: number[] }) => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]);
  const waits: number[] = [];
  process.env.GEMINI_API_KEY = "mock-only-key";
  process.env.GEMINI_MODEL = "mock-primary";
  process.env.GEMINI_FALLBACK_1 = "mock-fallback";
  for (const key of envKeys.slice(3)) delete process.env[key];

  try {
    await run({ waits });
  } finally {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("success: parses Gemini JSON from a successful mock response", async () => {
  await withHarness(async ({ waits }) => {
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "DISCOVER", callId: "call-success",
      fetchFn: async () => okResponse(),
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.deepEqual(result.data, output);
    assert.deepEqual(waits, []);
    assert.equal(result.model_used[0].outcome, "SUCCESS");
  });
});

test("fallback: advances after retryable primary failure and records both models", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "COMPOSE", candidateId: "candidate-1", callId: "call-fallback",
      fetchFn: async () => {
        request += 1;
        if (request <= 3) return new Response("temporary", { status: 503 });
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.deepEqual(result.data, output);
    assert.equal(request, 4);
    assert.deepEqual(waits, [1_000, 2_000]);
    assert.equal(result.model_used.length, 2);
    assert.equal(result.model_used[0].model, "mock-primary");
    assert.equal(result.model_used[0].outcome, "FALLBACK");
    assert.equal(result.model_used[0].attempts, 3);
    assert.equal(result.model_used[1].model, "mock-fallback");
    assert.equal(result.model_used[1].outcome, "SUCCESS");
    assert.equal(result.model_used[1].fallback_index, 1);
  });
});

test("timeout: retries a timed-out request and succeeds without network access", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "TEST", callId: "call-timeout",
      fetchFn: async () => {
        request += 1;
        if (request === 1) throw new DOMException("mock timeout", "TimeoutError");
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.deepEqual(result.data, output);
    assert.equal(request, 2);
    assert.deepEqual(waits, [1_000]);
    assert.equal(result.model_used[0].attempts, 2);
  });
});

test("429: skips a model on confirmed daily quota and falls back immediately", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "DISCOVER", callId: "call-429",
      fetchFn: async () => {
        request += 1;
        if (request === 1) return new Response(JSON.stringify({
          error: { code: 429, message: "Generate content requests per day quota exceeded" },
        }), { status: 429 });
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.equal(request, 2);
    assert.deepEqual(waits, []);
    assert.equal(result.model_used[0].outcome, "FALLBACK");
    assert.equal(result.model_used[0].attempts, 1);
    assert.equal(result.model_used[1].outcome, "SUCCESS");
  });
});

test("5xx: retries transient server errors with exponential backoff", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "REVISION", callId: "call-5xx",
      fetchFn: async () => {
        request += 1;
        if (request < 3) return new Response("server error", { status: 503 });
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.equal(request, 3);
    assert.deepEqual(waits, [1_000, 2_000]);
    assert.equal(result.model_used[0].outcome, "SUCCESS");
    assert.equal(result.model_used[0].attempts, 3);
  });
});

test("model_used: records stage, candidate, model, fallback index, attempts and outcome", async () => {
  await withHarness(async () => {
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "TEST", candidateId: "candidate-42", callId: "stable-call-id",
      fetchFn: async () => okResponse(),
    });
    assert.deepEqual(result.model_used, [{
      call_id: "stable-call-id",
      stage: "TEST",
      candidate_id: "candidate-42",
      model: "mock-primary",
      fallback_index: 0,
      attempts: 1,
      outcome: "SUCCESS",
    }]);
  });
});
